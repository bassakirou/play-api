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
    // Logic to check if user owns the artist or is the artist
    return this.prisma.album.create({
      data: createAlbumDto,
    });
  }

  async findAll() {
    const albums = await this.prisma.album.findMany({
      include: { artist: true, songs: true },
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
      include: { artist: true, songs: true },
    });
    if (!a) return null;
    return {
      ...a,
      coverUrl: a.coverUrl ? await this.refreshUrl(a.coverUrl) : null,
    };
  }

  private async refreshUrl(url: string) {
    if (!url.includes('?') || !this.minio.isEnabled()) return url;
    try {
      const u = new URL(url);
      const objectName = u.pathname.split('/').pop();
      if (!objectName) return url;
      return await this.minio.presignGet({ bucket: 'images', objectName });
    } catch {
      return url;
    }
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
