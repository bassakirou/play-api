import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';
import { MinioService } from '../storage/minio.service';

@Injectable()
export class VideoPlaylistsService {
  constructor(
    private prisma: PrismaService,
    private minio: MinioService,
  ) {}

  async findMine(userId: string) {
    const lists = await (this.prisma as any).videoPlaylist.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true },
    });
    return lists;
  }

  async findPublicByArtist(artistId: string) {
    const artist = await this.prisma.artist.findUnique({
      where: { id: artistId },
      select: { userId: true },
    });
    const userId = artist?.userId;
    if (!userId) return [];

    const lists = await (this.prisma as any).videoPlaylist.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        Video: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { thumbnailUrl: true },
        },
      },
    });

    return Promise.all(
      (lists || []).map(async (p: any) => {
        const thumb = p?.Video?.[0]?.thumbnailUrl
          ? await this.refreshUrl(p.Video[0].thumbnailUrl, 'images')
          : null;
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          createdAt: p.createdAt,
          thumbnailUrl: thumb,
        };
      }),
    );
  }

  async findOne(userId: string, playlistId: string) {
    const playlist = await (this.prisma as any).videoPlaylist.findFirst({
      where: { id: playlistId, userId },
      include: {
        Video: {
          include: {
            artists: true,
            genre: true,
            VideoPlaylist: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!playlist) throw new NotFoundException('Video playlist not found');

    const videos = Array.isArray(playlist?.Video) ? playlist.Video : [];
    const hydrated = await Promise.all(videos.map((v: any) => this.hydrateVideoUrls(v)));
    return {
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      userId: playlist.userId,
      createdAt: playlist.createdAt,
      updatedAt: playlist.updatedAt,
      videos: hydrated,
    };
  }

  async create(
    userId: string,
    dto: { name: string; description?: string },
  ) {
    const name = (dto?.name || '').trim();
    if (!name) throw new BadRequestException('name is required');

    const created = await (this.prisma as any).videoPlaylist.create({
      data: {
        id: randomUUID(),
        name,
        description: dto.description || null,
        userId,
        updatedAt: new Date(),
      },
      select: { id: true, name: true },
    });
    return created;
  }

  async addVideo(userId: string, playlistId: string, videoId: string) {
    const playlist = await (this.prisma as any).videoPlaylist.findFirst({
      where: { id: playlistId, userId },
      select: { id: true },
    });
    if (!playlist) throw new NotFoundException('Video playlist not found');

    try {
      await (this.prisma as any).videoPlaylist.update({
        where: { id: playlistId },
        data: { Video: { connect: { id: videoId } }, updatedAt: new Date() },
      });
    } catch {
      throw new BadRequestException('Cannot add video to playlist');
    }
    return this.findOne(userId, playlistId);
  }

  async removeVideo(userId: string, playlistId: string, videoId: string) {
    const playlist = await (this.prisma as any).videoPlaylist.findFirst({
      where: { id: playlistId, userId },
      select: { id: true },
    });
    if (!playlist) throw new NotFoundException('Video playlist not found');

    try {
      await (this.prisma as any).videoPlaylist.update({
        where: { id: playlistId },
        data: { Video: { disconnect: { id: videoId } }, updatedAt: new Date() },
      });
    } catch {
      throw new BadRequestException('Cannot remove video from playlist');
    }
    return this.findOne(userId, playlistId);
  }

  async delete(userId: string, playlistId: string) {
    const playlist = await (this.prisma as any).videoPlaylist.findFirst({
      where: { id: playlistId, userId },
      select: { id: true },
    });
    if (!playlist) {
      throw new NotFoundException('Video playlist not found');
    }
    await (this.prisma as any).videoPlaylist.delete({ where: { id: playlistId } });
    return { success: true };
  }

  private async hydrateVideoUrls(video: any) {
    return {
      ...video,
      videoUrl: video.videoUrl ? await this.refreshUrl(video.videoUrl, 'videos') : null,
      thumbnailUrl: video.thumbnailUrl
        ? await this.refreshUrl(video.thumbnailUrl, 'images')
        : null,
    };
  }

  private refreshUrl(url: string, _bucket: 'videos' | 'images') {
    if (!url) return url;
    const cleanUrl = url.replace('http://localhost:9000', 'https://media.pyramidplay.cm');
    return cleanUrl;
  }
}
