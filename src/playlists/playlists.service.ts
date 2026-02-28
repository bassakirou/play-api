import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PlaylistsService {
  constructor(private prisma: PrismaService) {}

  private includeRelations = {
    songs: {
      include: {
        artists: true,
        album: true,
        genre: true,
      },
    },
  };

  async findMine(userId: string) {
    return this.prisma.playlist.findMany({
      where: { userId },
      include: this.includeRelations,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(userId: string, name: string) {
    return this.prisma.playlist.create({
      data: { name, userId },
      include: this.includeRelations,
    });
  }

  async delete(userId: string, playlistId: string) {
    const playlist = await this.prisma.playlist.findFirst({
      where: { id: playlistId, userId },
    });
    if (!playlist) {
      throw new NotFoundException('Playlist not found');
    }
    await this.prisma.playlist.delete({ where: { id: playlistId } });
    return { success: true };
  }

  async addSong(userId: string, playlistId: string, songId: string) {
    const playlist = await this.prisma.playlist.findFirst({
      where: { id: playlistId, userId },
    });
    if (!playlist) {
      throw new NotFoundException('Playlist not found');
    }
    return this.prisma.playlist.update({
      where: { id: playlistId },
      data: { songs: { connect: { id: songId } } },
      include: this.includeRelations,
    });
  }

  async removeSong(userId: string, playlistId: string, songId: string) {
    const playlist = await this.prisma.playlist.findFirst({
      where: { id: playlistId, userId },
    });
    if (!playlist) {
      throw new NotFoundException('Playlist not found');
    }
    return this.prisma.playlist.update({
      where: { id: playlistId },
      data: { songs: { disconnect: { id: songId } } },
      include: this.includeRelations,
    });
  }
}
