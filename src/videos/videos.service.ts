import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../storage/minio.service';
import { CreateVideoDto } from './dto/create-video.dto';

@Injectable()
export class VideosService {
  constructor(
    private prisma: PrismaService,
    private minio: MinioService,
  ) { }

  async findAll() {
    const videos = await (this.prisma as any).video.findMany({
      where: { isPublished: true },
      include: {
        artists: true,
        genre: true,
        VideoPlaylist: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(videos.map((v) => this.hydrateUrls(v)));
  }

  async findAllAdmin() {
    const videos = await (this.prisma as any).video.findMany({
      include: {
        artists: true,
        genre: true,
        VideoPlaylist: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(videos.map((v) => this.hydrateUrls(v)));
  }

  async findOne(id: string) {
    const video = await (this.prisma as any).video.findUnique({
      where: { id },
      include: {
        artists: true,
        genre: true,
        VideoPlaylist: { select: { id: true, name: true } },
      },
    });
    if (!video) return null;
    return this.hydrateUrls(video);
  }

  async findByArtist(artistId: string) {
    const videos = await (this.prisma as any).video.findMany({
      where: { isPublished: true, artists: { some: { id: artistId } } },
      include: {
        artists: true,
        genre: true,
        VideoPlaylist: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(videos.map((v) => this.hydrateUrls(v)));
  }

  async create(createVideoDto: CreateVideoDto) {
    const dto = createVideoDto as unknown as Record<string, any>;
    const { artistIds, artistId, tags, thumbnailUrl, videoPlaylistIds, ...rest } = dto;

    const finalArtistIds: string[] = Array.isArray(artistIds)
      ? artistIds
      : artistId
        ? [artistId]
        : [];

    if (finalArtistIds.length === 0) {
      throw new BadRequestException('artistIds is required');
    }

    const data: any = {
      ...rest,
      tags: Array.isArray(tags) ? tags : [],
      thumbnailUrl: thumbnailUrl || null,
      artists: { connect: finalArtistIds.map((id) => ({ id })) },
      ...(videoPlaylistIds && Array.isArray(videoPlaylistIds)
        ? {
            VideoPlaylist: {
              connect: videoPlaylistIds.map((pid: string) => ({ id: pid })),
            },
          }
        : {}),
    };

    return (this.prisma as any).video.create({
      data,
      include: {
        artists: true,
        genre: true,
        VideoPlaylist: { select: { id: true, name: true } },
      },
    });
  }

  async createForUser(userId: string, body: any) {
    const artist = await this.prisma.artist.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!artist) {
      throw new BadRequestException('Create your channel first');
    }

    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const videoUrl = typeof body?.videoUrl === 'string' ? body.videoUrl.trim() : '';
    const thumbnailUrl =
      typeof body?.thumbnailUrl === 'string' ? body.thumbnailUrl.trim() : '';
    const duration = Number(body?.duration);

    if (!title) throw new BadRequestException('title is required');
    if (!videoUrl) throw new BadRequestException('videoUrl is required');
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new BadRequestException('duration is required');
    }

    const tags = Array.isArray(body?.tags) ? body.tags.filter(Boolean) : [];
    const genreId = typeof body?.genreId === 'string' ? body.genreId : undefined;

    const created = await (this.prisma as any).video.create({
      data: {
        title,
        description: typeof body?.description === 'string' ? body.description : null,
        videoUrl,
        thumbnailUrl: thumbnailUrl || null,
        duration: Math.trunc(duration),
        isPublished: typeof body?.isPublished === 'boolean' ? body.isPublished : true,
        category: typeof body?.category === 'string' ? body.category : null,
        tags,
        ...(genreId ? { genreId } : {}),
        artists: { connect: [{ id: artist.id }] },
        ...(Array.isArray(body?.videoPlaylistIds) && body.videoPlaylistIds.length > 0
          ? {
              VideoPlaylist: {
                connect: body.videoPlaylistIds.map((pid: string) => ({ id: pid })),
              },
            }
          : {}),
      },
      include: {
        artists: true,
        genre: true,
        VideoPlaylist: { select: { id: true, name: true } },
      },
    });

    return this.hydrateUrls(created);
  }

  async update(id: string, updateVideoDto: any) {
    const { artistIds, tags, thumbnailUrl, videoUrl, videoPlaylistIds, ...rest } =
      updateVideoDto || {};

    const data: Record<string, any> = { ...rest };

    if (typeof thumbnailUrl !== 'undefined') {
      data.thumbnailUrl = thumbnailUrl || null;
    }
    if (typeof videoUrl !== 'undefined') {
      data.videoUrl = videoUrl;
    }
    if (typeof tags !== 'undefined') {
      data.tags = Array.isArray(tags) ? tags : [];
    }

    const updateData: any = {
      ...data,
      ...(artistIds
        ? { artists: { set: artistIds.map((aid: string) => ({ id: aid })) } }
        : {}),
      ...(videoPlaylistIds
        ? {
            VideoPlaylist: {
              set: (videoPlaylistIds as string[]).map((pid) => ({ id: pid })),
            },
          }
        : {}),
    };

    return (this.prisma as any).video.update({
      where: { id },
      data: updateData,
      include: {
        artists: true,
        genre: true,
        VideoPlaylist: { select: { id: true, name: true } },
      },
    });
  }

  async updateMetrics(
    id: string,
    opts: { incrementViews?: boolean; likeDelta?: number },
  ) {
    const incViews = opts.incrementViews ? 1 : 0;
    const likeDelta =
      typeof opts.likeDelta === 'number' ? Math.trunc(opts.likeDelta) : 0;

    if (!incViews && !likeDelta) {
      return this.findOne(id);
    }

    const video = await (this.prisma as any).video.findUnique({
      where: { id },
      select: { id: true, likes: true },
    });
    if (!video) return null;

    const nextLikes = Math.max(0, Number(video.likes || 0) + likeDelta);
    const update = await (this.prisma as any).video.update({
      where: { id },
      data: {
        ...(incViews ? { views: { increment: incViews } } : {}),
        ...(likeDelta
          ? { likes: { set: nextLikes } }
          : {}),
      },
      include: {
        artists: true,
        genre: true,
        VideoPlaylist: { select: { id: true, name: true } },
      },
    });

    return this.hydrateUrls(update);
  }

  async remove(id: string) {
    const video = await (this.prisma as any).video.findUnique({ where: { id } });
    if (!video) throw new BadRequestException('Video not found');
    await (this.prisma as any).video.delete({ where: { id } });
    return { ok: true };
  }

  private async hydrateUrls(video: any) {
    const rawPlaylists = video?.VideoPlaylist || [];
    return {
      ...video,
      videoUrl: video.videoUrl
        ? await this.refreshUrl(video.videoUrl, 'videos')
        : null,
      thumbnailUrl: video.thumbnailUrl
        ? await this.refreshUrl(video.thumbnailUrl, 'images')
        : null,
      videoPlaylists: rawPlaylists,
    };
  }

  private refreshUrl(url: string | null | undefined, _bucket: 'videos' | 'images') {
    return this.minio.refreshUrl(url);
  }
}
