import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAlbumDto } from './dto/create-album.dto';

@Injectable()
export class AlbumsService {
  constructor(private prisma: PrismaService) {}

  async create(createAlbumDto: CreateAlbumDto) {
    // Logic to check if user owns the artist or is the artist
    return this.prisma.album.create({
      data: createAlbumDto,
    });
  }

  findAll() {
    return this.prisma.album.findMany({
      include: { artist: true, songs: true },
    });
  }

  findOne(id: string) {
    return this.prisma.album.findUnique({
      where: { id },
      include: { artist: true, songs: true },
    });
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
