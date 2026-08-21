import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAudiobookDto } from './dto/create-audiobook.dto';
import { UpdateAudiobookDto } from './dto/update-audiobook.dto';
import { CreateChapterDto } from './dto/create-chapter.dto';
import { UpdateChapterDto } from './dto/update-chapter.dto';

@Injectable()
export class AudiobooksService {
  constructor(private prisma: PrismaService) {}

  async findAll(params?: {
    category?: string;
    isTrending?: boolean;
    search?: string;
    authorId?: string;
  }) {
    const where: any = {};

    if (params?.category && params.category !== 'all' && params.category !== 'Tous') {
      where.category = {
        equals: params.category,
        mode: 'insensitive',
      };
    }

    if (params?.isTrending !== undefined) {
      where.isTrending = params.isTrending;
    }

    if (params?.authorId) {
      where.authorId = params.authorId;
    }

    if (params?.search && params.search.trim().length > 0) {
      const s = params.search.trim();
      where.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { author: { contains: s, mode: 'insensitive' } },
        { narrator: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
      ];
    }

    return this.prisma.audiobook.findMany({
      where,
      include: {
        chapters: {
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        },
        authorUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: [{ isTrending: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(id: string) {
    const book = await this.prisma.audiobook.findUnique({
      where: { id },
      include: {
        chapters: {
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        },
        authorUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!book) {
      throw new NotFoundException(`Audiobook with ID ${id} not found`);
    }

    return book;
  }

  async getCategories() {
    const books = await this.prisma.audiobook.findMany({
      select: { category: true },
    });

    const categoryMap = new Map<string, number>();
    for (const b of books) {
      const cat = b.category || 'Général';
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
    }

    return Array.from(categoryMap.entries()).map(([name, count]) => ({
      name,
      count,
    }));
  }

  async getAuthors() {
    // 1. Registered AUTHOR users
    const authorUsers = await this.prisma.user.findMany({
      where: {
        systemRoles: {
          has: 'AUTHOR',
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    // 2. Authors from existing audiobooks
    const audiobooks = await this.prisma.audiobook.findMany({
      select: {
        author: true,
        authorId: true,
      },
    });

    const authorsMap = new Map<string, { name: string; authorId?: string; count: number }>();

    for (const u of authorUsers) {
      authorsMap.set(u.name.toLowerCase(), {
        name: u.name,
        authorId: u.id,
        count: 0,
      });
    }

    for (const a of audiobooks) {
      const key = a.author.toLowerCase();
      const existing = authorsMap.get(key);
      if (existing) {
        existing.count++;
        if (a.authorId && !existing.authorId) {
          existing.authorId = a.authorId;
        }
      } else {
        authorsMap.set(key, {
          name: a.author,
          authorId: a.authorId || undefined,
          count: 1,
        });
      }
    }

    return Array.from(authorsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async create(dto: CreateAudiobookDto) {
    let authorName = dto.author;
    if (dto.authorId && (!authorName || authorName.trim().length === 0)) {
      const user = await this.prisma.user.findUnique({ where: { id: dto.authorId } });
      if (user) {
        authorName = user.name;
      }
    }

    return this.prisma.audiobook.create({
      data: {
        title: dto.title,
        author: authorName,
        authorId: dto.authorId || null,
        narrator: dto.narrator || null,
        description: dto.description || null,
        coverUrl: dto.coverUrl || null,
        category: dto.category || 'Général',
        isTrending: dto.isTrending ?? false,
        rating: dto.rating ?? 5.0,
      },
      include: {
        chapters: true,
        authorUser: true,
      },
    });
  }

  async update(id: string, dto: UpdateAudiobookDto) {
    await this.findOne(id);

    return this.prisma.audiobook.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.author !== undefined && { author: dto.author }),
        ...(dto.authorId !== undefined && { authorId: dto.authorId || null }),
        ...(dto.narrator !== undefined && { narrator: dto.narrator || null }),
        ...(dto.description !== undefined && { description: dto.description || null }),
        ...(dto.coverUrl !== undefined && { coverUrl: dto.coverUrl || null }),
        ...(dto.category !== undefined && { category: dto.category || 'Général' }),
        ...(dto.isTrending !== undefined && { isTrending: dto.isTrending }),
        ...(dto.rating !== undefined && { rating: dto.rating }),
      },
      include: {
        chapters: {
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        },
        authorUser: true,
      },
    });
  }

  async delete(id: string) {
    await this.findOne(id);
    return this.prisma.audiobook.delete({ where: { id } });
  }

  // --- CHAPTERS MANAGEMENT ---

  async addChapter(audiobookId: string, dto: CreateChapterDto) {
    await this.findOne(audiobookId);

    const existingChapters = await this.prisma.audiobookChapter.findMany({
      where: { audiobookId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });

    const nextOrder = dto.order !== undefined ? dto.order : existingChapters.length + 1;
    const computedStartAt =
      dto.startAt !== undefined
        ? dto.startAt
        : existingChapters.reduce((acc, c) => acc + (c.duration || 0), 0);

    const chapter = await this.prisma.audiobookChapter.create({
      data: {
        audiobookId,
        title: dto.title,
        duration: dto.duration || 0,
        startAt: computedStartAt,
        audioUrl: dto.audioUrl || null,
        order: nextOrder,
      },
    });

    await this.recalculateDuration(audiobookId);
    return chapter;
  }

  async updateChapter(audiobookId: string, chapterId: string, dto: UpdateChapterDto) {
    const chapter = await this.prisma.audiobookChapter.findUnique({
      where: { id: chapterId },
    });

    if (!chapter || chapter.audiobookId !== audiobookId) {
      throw new NotFoundException(`Chapter ${chapterId} not found in audiobook ${audiobookId}`);
    }

    const updated = await this.prisma.audiobookChapter.update({
      where: { id: chapterId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.duration !== undefined && { duration: dto.duration }),
        ...(dto.startAt !== undefined && { startAt: dto.startAt }),
        ...(dto.audioUrl !== undefined && { audioUrl: dto.audioUrl || null }),
        ...(dto.order !== undefined && { order: dto.order }),
      },
    });

    await this.recalculateDuration(audiobookId);
    return updated;
  }

  async deleteChapter(audiobookId: string, chapterId: string) {
    const chapter = await this.prisma.audiobookChapter.findUnique({
      where: { id: chapterId },
    });

    if (!chapter || chapter.audiobookId !== audiobookId) {
      throw new NotFoundException(`Chapter ${chapterId} not found in audiobook ${audiobookId}`);
    }

    const deleted = await this.prisma.audiobookChapter.delete({
      where: { id: chapterId },
    });

    await this.recalculateDuration(audiobookId);
    return deleted;
  }

  private async recalculateDuration(audiobookId: string) {
    const chapters = await this.prisma.audiobookChapter.findMany({
      where: { audiobookId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });

    let currentStartAt = 0;
    let totalDuration = 0;

    for (const ch of chapters) {
      totalDuration += ch.duration || 0;
      if (ch.startAt !== currentStartAt) {
        await this.prisma.audiobookChapter.update({
          where: { id: ch.id },
          data: { startAt: currentStartAt },
        });
      }
      currentStartAt += ch.duration || 0;
    }

    await this.prisma.audiobook.update({
      where: { id: audiobookId },
      data: { duration: totalDuration },
    });
  }
}
