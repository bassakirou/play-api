import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAlbumDto } from './dto/create-album.dto';
import { MinioService } from '../storage/minio.service';

@Injectable()
export class AlbumsService {
  constructor(
    private prisma: PrismaService,
    private minio: MinioService,
  ) {}

  async create(createAlbumDto: CreateAlbumDto) {
    const { title, year, coverUrl, description, artistId, artistIds, groupIds } = createAlbumDto as any;
    const finalArtistId = artistId || (artistIds && artistIds.length ? artistIds[0] : null);
    const data: any = {
      title,
      year: Number(year),
      coverUrl: coverUrl || null,
      description: description || null,
      ...(finalArtistId ? { artist: { connect: { id: finalArtistId } } } : {}),
      ...(groupIds && groupIds.length
        ? { groups: { connect: groupIds.map((gid: string) => ({ id: gid })) } }
        : {}),
    };
    return this.prisma.album.create({
      data,
      include: { artist: true, groups: true },
    });
  }

  async findAll() {
    // Nettoyage automatique des albums orphelins sans aucune chanson rattachée
    const emptyAlbums = await this.prisma.album.findMany({
      where: { songs: { none: {} } },
      select: { id: true },
    });
    if (emptyAlbums.length > 0) {
      await this.prisma.album.deleteMany({
        where: { id: { in: emptyAlbums.map((a) => a.id) } },
      });
    }

    const albums = await this.prisma.album.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        artist: true,
        groups: true,
        songs: {
          include: {
            groups: true,
            artists: true,
          },
        },
      },
    });
    return Promise.all(
      albums.map(async (a) => ({
        ...a,
        coverUrl: a.coverUrl ? await this.refreshUrl(a.coverUrl) : null,
      })),
    );
  }

  async findOne(id: string) {
    const a = await this.prisma.album.findUnique({
      where: { id },
      include: {
        artist: true,
        groups: true,
        songs: {
          include: {
            groups: true,
            artists: true,
          },
        },
      },
    });
    if (!a) return null;
    return {
      ...a,
      coverUrl: a.coverUrl ? await this.refreshUrl(a.coverUrl) : null,
    };
  }

  private refreshUrl(url: string | null | undefined) {
    return this.minio.refreshUrl(url);
  }

  update(id: string, updateAlbumDto: any) {
    return this.prisma.album.update({
      where: { id },
      data: updateAlbumDto,
    });
  }

  async remove(id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.song.deleteMany({ where: { albumId: id } });
      return tx.album.delete({ where: { id } });
    });
  }
}
