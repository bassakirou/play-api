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
    const { title, year, coverUrl, description, artistId } = createAlbumDto;
    const data: any = {
      title,
      year,
      coverUrl: coverUrl || null,
      description: description || null,
      ...(artistId ? { artist: { connect: { id: artistId } } } : {}),
    };
    return this.prisma.album.create({
      data,
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
      include: {
        artist: true,
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
