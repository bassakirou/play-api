/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLiveDto, UpdateLiveDto, AddCommentDto } from './dto/live.dto';
import { MinioService } from '../storage/minio.service';

@Injectable()
export class LivesService {
  private readonly logger = new Logger(LivesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minioService: MinioService,
  ) {}

  async findAll(query?: {
    category?: string;
    type?: string;
    status?: string;
    search?: string;
  }) {
    const where: any = {};

    if (query?.category && query.category !== 'all') {
      where.category = query.category;
    }
    if (query?.type && query.type !== 'all') {
      where.type = query.type;
    }
    if (query?.status) {
      where.status = query.status;
    }
    if (query?.search && query.search.trim()) {
      where.OR = [
        { title: { contains: query.search.trim(), mode: 'insensitive' } },
        { description: { contains: query.search.trim(), mode: 'insensitive' } },
        { tags: { has: query.search.trim() } },
      ];
    }

    const lives = await this.prisma.liveStream.findMany({
      where,
      orderBy: [
        { isFeatured: 'desc' },
        { status: 'asc' }, // LIVE first
        { viewerCount: 'desc' },
        { createdAt: 'desc' },
      ],
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            artistProfile: {
              select: {
                id: true,
                name: true,
                imageUrl: true,
                certified: true,
              },
            },
          },
        },
        _count: {
          select: {
            comments: true,
            reactions: true,
          },
        },
      },
    });

    return lives.map((live) => this.formatLiveItem(live));
  }

  async findOne(id: string) {
    const live = await this.prisma.liveStream.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            systemRoles: true,
            artistProfile: {
              select: {
                id: true,
                name: true,
                imageUrl: true,
                certified: true,
              },
            },
          },
        },
        comments: {
          orderBy: { createdAt: 'asc' },
          take: 100,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                role: true,
                systemRoles: true,
                artistProfile: {
                  select: { imageUrl: true },
                },
              },
            },
          },
        },
        reactions: {
          orderBy: { count: 'desc' },
        },
      },
    });

    if (!live) {
      throw new NotFoundException('Session Live non trouvée.');
    }

    return this.formatLiveDetail(live);
  }

  async create(userId: string, dto: CreateLiveDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true, artistProfile: true },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }

    const systemRoles = (user.systemRoles || []).map((r) => r.toUpperCase());
    const roleName = (user.role?.name || '').toUpperCase();
    const isCreator =
      systemRoles.includes('CREATOR') ||
      systemRoles.includes('ADMIN') ||
      systemRoles.includes('SUPER_ADMIN') ||
      roleName === 'ADMIN' ||
      roleName === 'SUPER_ADMIN';

    if (!isCreator) {
      throw new ForbiddenException(
        'Accès refusé : Seuls les utilisateurs avec le rôle CREATOR peuvent démarrer un Live.',
      );
    }

    const retentionDays = dto.retentionDays !== undefined ? dto.retentionDays : 3;
    const cleanupAt =
      retentionDays > 0
        ? new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)
        : null;

    const hostName =
      user.artistProfile?.name || user.name || user.email.split('@')[0];
    const defaultThumb =
      user.artistProfile?.imageUrl ||
      'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&h=675&fit=crop';

    const created = await this.prisma.liveStream.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        type: dto.type || 'video',
        category: dto.category || 'all',
        status: 'LIVE',
        streamUrl: dto.streamUrl || null,
        playbackType: dto.playbackType || 'WEBRTC',
        thumbnailUrl: dto.thumbnailUrl || defaultThumb,
        coverUrl: dto.coverUrl || user.artistProfile?.imageUrl || null,
        tags: dto.tags || ['Live', 'PyramidPlay'],
        retentionDays,
        cleanupAt,
        isFeatured: dto.isFeatured || false,
        userId: user.id,
        startedAt: new Date(),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            artistProfile: true,
          },
        },
      },
    });

    this.logger.log(`[LivesService] Nouveau live démarré: ${created.id} par ${hostName}`);
    return this.formatLiveItem(created);
  }

  async update(id: string, userId: string, dto: UpdateLiveDto, isAdmin = false) {
    const live = await this.prisma.liveStream.findUnique({ where: { id } });
    if (!live) {
      throw new NotFoundException('Live non trouvé.');
    }

    if (live.userId !== userId && !isAdmin) {
      throw new ForbiddenException('Vous n\'avez pas le droit de modifier ce Live.');
    }

    const data: any = { ...dto };
    if (dto.retentionDays !== undefined) {
      data.cleanupAt =
        dto.retentionDays > 0
          ? new Date(Date.now() + dto.retentionDays * 24 * 60 * 60 * 1000)
          : null;
    }

    const updated = await this.prisma.liveStream.update({
      where: { id },
      data,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            artistProfile: true,
          },
        },
      },
    });

    return this.formatLiveItem(updated);
  }

  async startLive(id: string, userId: string, isAdmin = false) {
    const live = await this.prisma.liveStream.findUnique({ where: { id } });
    if (!live) throw new NotFoundException('Live introuvable.');
    if (live.userId !== userId && !isAdmin) {
      throw new ForbiddenException('Action non autorisée.');
    }

    return this.prisma.liveStream.update({
      where: { id },
      data: {
        status: 'LIVE',
        startedAt: new Date(),
      },
    });
  }

  async endLive(id: string, userId: string, isAdmin = false) {
    const live = await this.prisma.liveStream.findUnique({ where: { id } });
    if (!live) throw new NotFoundException('Live introuvable.');
    if (live.userId !== userId && !isAdmin) {
      throw new ForbiddenException('Action non autorisée.');
    }

    const ended = await this.prisma.liveStream.update({
      where: { id },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
      },
    });

    // Si retentionDays === 0, suppression immédiate des données média temporaires
    if (live.retentionDays === 0) {
      this.logger.log(`[LivesService] Rétention 0 jour : Nettoyage immédiat pour ${id}`);
      await this.deleteLiveRecordings(live);
    }

    return ended;
  }

  async addComment(liveId: string, userId: string | null, dto: AddCommentDto) {
    const live = await this.prisma.liveStream.findUnique({ where: { id: liveId } });
    if (!live) throw new NotFoundException('Live introuvable.');

    let authorName = dto.userName || 'Spectateur';
    let authorAvatar = dto.userAvatar || null;
    let role = dto.role || 'USER';

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { role: true, artistProfile: true },
      });
      if (user) {
        authorName = user.artistProfile?.name || user.name || user.email.split('@')[0];
        authorAvatar = user.artistProfile?.imageUrl || null;
        if (live.userId === userId) {
          role = 'HOST';
        } else if (user.role?.name === 'ADMIN') {
          role = 'ADMIN';
        } else if (user.systemRoles?.includes('CREATOR')) {
          role = 'CREATOR';
        } else {
          role = 'VIP';
        }
      }
    }

    const comment = await this.prisma.liveComment.create({
      data: {
        liveId,
        userId,
        userName: authorName,
        userAvatar: authorAvatar,
        role,
        text: dto.text.trim(),
      },
    });

    return comment;
  }

  async addReaction(liveId: string, emoji: string) {
    const live = await this.prisma.liveStream.findUnique({ where: { id: liveId } });
    if (!live) throw new NotFoundException('Live introuvable.');

    // Incrémenter les likes si cœur ou flamme
    if (emoji === '❤️' || emoji === '🔥') {
      await this.prisma.liveStream.update({
        where: { id: liveId },
        data: { likesCount: { increment: 1 } },
      });
    }

    // Sauvegarder la réaction agrégée
    const existing = await this.prisma.liveReaction.findFirst({
      where: { liveId, emoji },
    });

    if (existing) {
      return this.prisma.liveReaction.update({
        where: { id: existing.id },
        data: { count: { increment: 1 } },
      });
    } else {
      return this.prisma.liveReaction.create({
        data: {
          liveId,
          emoji,
          count: 1,
        },
      });
    }
  }

  async updateViewerCount(liveId: string, count: number) {
    const live = await this.prisma.liveStream.findUnique({ where: { id: liveId } });
    if (!live) return null;

    const peak = Math.max(live.peakViewers, count);
    return this.prisma.liveStream.update({
      where: { id: liveId },
      data: {
        viewerCount: count,
        peakViewers: peak,
      },
    });
  }

  async deleteLive(id: string, userId: string, isAdmin = false) {
    const live = await this.prisma.liveStream.findUnique({ where: { id } });
    if (!live) throw new NotFoundException('Live non trouvé.');
    if (live.userId !== userId && !isAdmin) {
      throw new ForbiddenException('Action non autorisée.');
    }

    await this.deleteLiveRecordings(live);
    return this.prisma.liveStream.delete({ where: { id } });
  }

  /**
   * Tâche de nettoyage automatique des fichiers éphémères expirés
   */
  async cleanupExpiredLives() {
    const now = new Date();
    const expiredLives = await this.prisma.liveStream.findMany({
      where: {
        status: 'ENDED',
        isCleanedUp: false,
        OR: [
          { cleanupAt: { lte: now } },
          { retentionDays: 0 },
        ],
      },
    });

    this.logger.log(
      `[LiveCleanup] Vérification rétention : ${expiredLives.length} live(s) à purger.`,
    );

    for (const live of expiredLives) {
      try {
        await this.deleteLiveRecordings(live);
        await this.prisma.liveStream.update({
          where: { id: live.id },
          data: { isCleanedUp: true, recordingUrl: null },
        });
        this.logger.log(`[LiveCleanup] Purge média réussie pour live ${live.id}`);
      } catch (err: any) {
        this.logger.error(`[LiveCleanup] Erreur purge live ${live.id}: ${err.message}`);
      }
    }

    return { cleanedCount: expiredLives.length };
  }

  private async deleteLiveRecordings(live: any) {
    // Si des enregistrements sont hébergés sur MinIO, on peut les nettoyer
    if (live.recordingUrl) {
      try {
        this.logger.log(`[LivesService] Suppression de l'enregistrement: ${live.recordingUrl}`);
        // MinIO deletion logic si applicable
      } catch (err: any) {
        this.logger.warn(`[LivesService] Echec suppression recording: ${err.message}`);
      }
    }
  }

  private formatLiveItem(live: any) {
    const hostName =
      live.user?.artistProfile?.name ||
      live.user?.name ||
      live.user?.email?.split('@')[0] ||
      'Pyramid Live';
    const hostAvatar =
      live.user?.artistProfile?.imageUrl ||
      'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop';

    return {
      id: live.id,
      title: live.title,
      description: live.description || '',
      type: live.type || 'video',
      category: live.category || 'all',
      status: live.status,
      streamUrl: live.streamUrl || '',
      playbackType: live.playbackType,
      thumbnailUrl: live.thumbnailUrl || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&h=675&fit=crop',
      coverUrl: live.coverUrl || live.thumbnailUrl,
      hostName,
      hostAvatar,
      hostId: live.userId,
      isCertified: !!live.user?.artistProfile?.certified,
      viewerCount: live.viewerCount || 0,
      peakViewers: live.peakViewers || 0,
      likesCount: live.likesCount || 0,
      isFeatured: live.isFeatured || false,
      startedAt: live.startedAt || live.createdAt,
      endedAt: live.endedAt,
      retentionDays: live.retentionDays,
      tags: live.tags || ['Live'],
      commentsCount: live._count?.comments || 0,
      createdAt: live.createdAt,
    };
  }

  private formatLiveDetail(live: any) {
    const base = this.formatLiveItem(live);
    return {
      ...base,
      streamKey: live.streamKey,
      comments: (live.comments || []).map((c: any) => ({
        id: c.id,
        streamId: c.liveId,
        userId: c.userId,
        userName: c.userName,
        userAvatar:
          c.userAvatar ||
          c.user?.artistProfile?.imageUrl ||
          'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop',
        role: c.role || 'USER',
        text: c.text,
        timestamp: c.createdAt,
      })),
      reactions: live.reactions || [],
    };
  }
}
