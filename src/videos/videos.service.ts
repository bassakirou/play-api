import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../storage/minio.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { DeliveryCaller, VideoDeliveryService } from '../video-delivery/video-delivery.service';
import { randomUUID } from 'crypto';

const defaultInclude = {
  mediaAsset: { include: { delivery: true } },
  artists: true,
  genre: true,
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      artistProfile: true,
    },
  },
  VideoPlaylist: { select: { id: true, name: true } },
  videoCategory: true,
  videoTags: { include: { tag: true } },
};

@Injectable()
export class VideosService {
  constructor(
    private prisma: PrismaService,
    private minio: MinioService,
    private delivery: VideoDeliveryService,
  ) { }

  async findAll(category?: string, isAcademic?: boolean) {
    const where: any = { isPublished: true };
    if (category) {
      where.OR = [
        { category: { equals: category, mode: 'insensitive' } },
        { videoCategory: { normalizedName: category.trim().toLowerCase() } },
      ];
    }
    if (isAcademic !== undefined) {
      where.isAcademic = isAcademic;
    }
    const videos = await (this.prisma as any).video.findMany({
      where,
      include: defaultInclude,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(videos.map((v) => this.hydrateUrls(v)));
  }

  async findAllAdmin(caller?: DeliveryCaller) {
    const videos = await (this.prisma as any).video.findMany({
      where: ['ADMIN', 'SUPER_ADMIN'].includes(caller?.role || '') ? {} : { userId: caller?.id || '__unauthorized__' },
      include: defaultInclude,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(videos.map((v) => this.hydrateUrls(v, true)));
  }

  async findOne(id: string) {
    const video = await (this.prisma as any).video.findUnique({
      where: { id },
      include: defaultInclude,
    });
    if (!video) return null;
    return this.hydrateUrls(video);
  }

  async getTaxonomy(category?: string) {
    const categories = await (this.prisma as any).videoCategory.findMany({ orderBy: { name: 'asc' } });
    const selectedCategory = category?.trim().toLowerCase();
    const tags = await (this.prisma as any).videoTag.findMany({
      where: selectedCategory ? { category: { normalizedName: selectedCategory } } : undefined,
      orderBy: { name: 'asc' },
    });
    return { categories, tags };
  }

  async findRecommendations(id: string, limit = 8) {
    const source = await (this.prisma as any).video.findUnique({ where: { id }, include: defaultInclude });
    if (!source) return [];
    const candidates = await (this.prisma as any).video.findMany({
      where: { isPublished: true, id: { not: id } },
      include: defaultInclude,
      take: 100,
      orderBy: [{ views: 'desc' }, { likes: 'desc' }, { createdAt: 'desc' }],
    });
    const sourceTags = new Set((source.videoTags?.map((item: any) => item.tag.normalizedName) || source.tags || []).map((tag: string) => tag.toLowerCase()));
    const sourceArtists = new Set((source.artists || []).map((artist: any) => artist.id));
    const sourceCategory = source.videoCategory?.id || source.categoryId || source.category?.trim().toLowerCase();
    const scored = candidates.map((candidate: any) => {
      const candidateTags = candidate.videoTags?.map((item: any) => item.tag.normalizedName) || candidate.tags || [];
      const commonTags = candidateTags.filter((tag: string) => sourceTags.has(tag.toLowerCase())).length;
      const sameCategory = (candidate.videoCategory?.id || candidate.categoryId || candidate.category?.trim().toLowerCase()) === sourceCategory;
      const sameArtist = candidate.artists?.some((artist: any) => sourceArtists.has(artist.id));
      const popularity = Math.min(25, Math.log10(Math.max(1, candidate.views || 0)) * 10 + Math.log10(Math.max(1, candidate.likes || 0)) * 5);
      const freshness = Math.max(0, 10 - Math.floor((Date.now() - new Date(candidate.createdAt).getTime()) / 86_400_000));
      return { candidate, score: (sameCategory ? 100 : 0) + commonTags * 30 + (sameArtist ? 15 : 0) + popularity + freshness };
    });
    return Promise.all(scored.sort((left, right) => right.score - left.score).slice(0, Math.max(1, Math.min(limit, 20))).map(({ candidate }) => this.hydrateUrls(candidate)));
  }

  async findByArtist(artistId: string) {
    const videos = await (this.prisma as any).video.findMany({
      where: { isPublished: true, artists: { some: { id: artistId } } },
      include: defaultInclude,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(videos.map((v) => this.hydrateUrls(v)));
  }

  async findByUser(userId: string) {
    const artistProfile = await this.prisma.artist.findUnique({
      where: { userId },
      select: { id: true },
    });

    const videos = await (this.prisma as any).video.findMany({
      where: {
        OR: [
          { userId },
          { artists: { some: { userId } } },
          ...(artistProfile ? [{ artists: { some: { id: artistProfile.id } } }] : []),
        ],
      },
      include: defaultInclude,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(videos.map((v) => this.hydrateUrls(v, true)));
  }

  async create(createVideoDto: CreateVideoDto, userId?: string, role?: string) {
    const dto = createVideoDto as unknown as Record<string, any>;
    const {
      artistIds,
      artistId,
      channelId,
      userId: explicitUserId,
      tags,
      thumbnailUrl,
      videoPlaylistIds,
      mediaAssetId,
      publishWhenReady: _ignoredPublishIntent,
      mediaAsset: _ignoredAsset,
      ...rest
    } = dto;

    const finalArtistIds: string[] = Array.isArray(artistIds)
      ? artistIds
      : artistId
        ? [artistId]
        : channelId
          ? [channelId]
          : [];

    let effectiveUserId = explicitUserId || userId;

    if (channelId) {
      const channel = await this.prisma.artist.findUnique({
        where: { id: channelId },
        select: { userId: true },
      });
      if (channel?.userId) {
        effectiveUserId = channel.userId;
      }
    }

    if (!effectiveUserId) {
      const adminUser = await (this.prisma as any).user.findFirst({
        where: { role: { name: 'ADMIN' } },
        select: { id: true },
      }) || await (this.prisma as any).user.findFirst({ select: { id: true } });
      effectiveUserId = adminUser?.id;
    }

    const taxonomy = await this.resolveTaxonomy(rest.category, tags);
    const publication = await this.delivery.preparePublication(mediaAssetId, !!rest.isPublished, { id: userId, role });
    const videoId = randomUUID();
    const data: any = {
      ...rest,
      ...publication,
      id: videoId,
      videoUrl: await this.delivery.sourceReference(videoId, mediaAssetId, rest.videoUrl),
      isAcademic: Boolean(dto.isAcademic),
      isMonetized: Boolean(dto.isMonetized),
      price: dto.isMonetized && dto.price ? Number(dto.price) : 0,
      discountPrice: dto.isMonetized && dto.discountPrice ? Number(dto.discountPrice) : null,
      category: taxonomy.categoryName,
      categoryId: taxonomy.categoryId,
      tags: taxonomy.tags.map((tag) => tag.name),
      thumbnailUrl: thumbnailUrl || null,
      userId: effectiveUserId || null,
      ...(finalArtistIds.length > 0
        ? { artists: { connect: finalArtistIds.map((id) => ({ id })) } }
        : {}),
      ...(taxonomy.tags.length > 0 ? { videoTags: { create: taxonomy.tags.map((tag) => ({ tag: { connect: { id: tag.id } } })) } } : {}),
      ...(videoPlaylistIds && Array.isArray(videoPlaylistIds) && videoPlaylistIds.length > 0
        ? {
            VideoPlaylist: {
              connect: videoPlaylistIds.map((pid: string) => ({ id: pid })),
            },
          }
        : {}),
    };

    const created = await (this.prisma as any).video.create({
      data,
      include: defaultInclude,
    });

    return this.hydrateUrls(created, true);
  }

  async createForUser(userId: string, body: any, role?: string) {
    let artist = await this.prisma.artist.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!artist) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      const defaultName = (user?.name || user?.email.split('@')[0] || 'Chaîne').trim();
      artist = await this.prisma.artist.create({
        data: {
          name: defaultName,
          userId,
        },
        select: { id: true },
      });
    }

    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const videoUrl = typeof body?.videoUrl === 'string' ? body.videoUrl.trim() : '';
    const thumbnailUrl =
      typeof body?.thumbnailUrl === 'string' && body.thumbnailUrl.trim().length > 0
        ? body.thumbnailUrl.trim()
        : null;
    const duration = Number(body?.duration);

    if (!title) {
      throw new BadRequestException('title is required');
    }
    if (!videoUrl) {
      throw new BadRequestException('videoUrl is required');
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new BadRequestException('duration must be > 0');
    }

    const taxonomy = await this.resolveTaxonomy(body?.category, body?.tags);
    const genreId = typeof body?.genreId === 'string' ? body.genreId : undefined;

    const publication = await this.delivery.preparePublication(body.mediaAssetId, body.isPublished !== false, { id: userId, role });
    const videoId = randomUUID();
    const created = await (this.prisma as any).video.create({
      data: {
        title,
        description: typeof body?.description === 'string' ? body.description : null,
        id: videoId,
        videoUrl: await this.delivery.sourceReference(videoId, body.mediaAssetId, videoUrl),
        thumbnailUrl: thumbnailUrl || null,
        duration: Math.trunc(duration),
        isAcademic: Boolean(body?.isAcademic),
        isMonetized: Boolean(body?.isMonetized),
        price: body?.isMonetized && body?.price ? Number(body.price) : 0,
        discountPrice: body?.isMonetized && body?.discountPrice ? Number(body.discountPrice) : null,
        ...publication,
        category: taxonomy.categoryName,
        categoryId: taxonomy.categoryId,
        tags: taxonomy.tags.map((tag) => tag.name),
        ...(taxonomy.tags.length > 0 ? { videoTags: { create: taxonomy.tags.map((tag) => ({ tag: { connect: { id: tag.id } } })) } } : {}),
        userId,
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
      include: defaultInclude,
    });

    return this.hydrateUrls(created, true);
  }

  async update(id: string, updateVideoDto: any, caller?: DeliveryCaller) {
    const existing = await this.prisma.video.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('Video not found');
    if (!['ADMIN', 'SUPER_ADMIN'].includes(caller?.role || '') && (!caller?.id || existing.userId !== caller.id)) throw new ForbiddenException();
    const {
      artistIds,
      channelId,
      userId,
      tags,
      thumbnailUrl,
      videoUrl,
      videoPlaylistIds,
      mediaAssetId,
      publishWhenReady: _ignoredPublishIntent,
      mediaAsset: _ignoredAsset,
      ...rest
    } = updateVideoDto || {};

    const data: Record<string, any> = { ...rest };
    const publication = await this.delivery.preparePublication(
      mediaAssetId === undefined ? existing.mediaAssetId : mediaAssetId,
      typeof rest.isPublished === 'boolean' ? rest.isPublished : existing.isPublished || existing.publishWhenReady,
      caller || {},
    );
    Object.assign(data, publication);
    if (typeof rest.isAcademic !== 'undefined') {
      data.isAcademic = Boolean(rest.isAcademic);
    }
    if (typeof rest.isMonetized !== 'undefined') {
      data.isMonetized = Boolean(rest.isMonetized);
    }
    if (typeof rest.price !== 'undefined') {
      data.price = rest.price !== null ? Number(rest.price) : 0;
    }
    if (typeof rest.discountPrice !== 'undefined') {
      data.discountPrice = rest.discountPrice !== null ? Number(rest.discountPrice) : null;
    }

    if (channelId) {
      const channel = await this.prisma.artist.findUnique({
        where: { id: channelId },
        select: { userId: true },
      });
      if (channel?.userId) {
        data.userId = channel.userId;
      }
    } else if (userId) {
      data.userId = userId;
    }

    if (typeof thumbnailUrl !== 'undefined') {
      data.thumbnailUrl = thumbnailUrl || null;
    }
    if (typeof videoUrl !== 'undefined') {
      data.videoUrl = videoUrl;
    }
    data.videoUrl = await this.delivery.sourceReference(id, publication.mediaAssetId, data.videoUrl || existing.videoUrl);
    if (typeof tags !== 'undefined' || typeof rest.category !== 'undefined') {
      const current = await (this.prisma as any).video.findUnique({ where: { id }, select: { category: true, tags: true } });
      const taxonomy = await this.resolveTaxonomy(typeof rest.category !== 'undefined' ? rest.category : current?.category, typeof tags !== 'undefined' ? tags : current?.tags);
      data.category = taxonomy.categoryName;
      data.categoryId = taxonomy.categoryId;
      data.tags = taxonomy.tags.map((tag) => tag.name);
      data.videoTags = { set: taxonomy.tags.map((tag) => ({ tagId: tag.id })) };
    }

    const effectiveArtistIds = Array.isArray(artistIds)
      ? artistIds
      : channelId
        ? [channelId]
        : undefined;

    const updateData: any = {
      ...data,
      ...(effectiveArtistIds
        ? { artists: { set: effectiveArtistIds.map((aid: string) => ({ id: aid })) } }
        : {}),
      ...(videoPlaylistIds
        ? {
            VideoPlaylist: {
              set: (videoPlaylistIds as string[]).map((pid) => ({ id: pid })),
            },
          }
        : {}),
    };

    const updated = await (this.prisma as any).video.update({
      where: { id },
      data: updateData,
      include: defaultInclude,
    });

    return this.hydrateUrls(updated, true);
  }

  async updateMetrics(
    id: string,
    opts: { incrementViews?: boolean; likeDelta?: number; country?: string },
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
      include: defaultInclude,
    });

    // Raw events are intentionally retained alongside counters so category/tag
    // analytics can later be grouped by content, search origin and country.
    if (incViews || likeDelta) {
      const eventType = incViews ? 'VIEW' : 'LIKE';
      const tagIds = update.videoTags?.map((item: any) => item.tagId).filter(Boolean) || [];
      await (this.prisma as any).videoTaxonomyEvent.createMany({
        data: [
          { type: eventType, country: opts.country?.slice(0, 2).toUpperCase() || null, videoId: update.id, categoryId: update.categoryId || null },
          ...tagIds.map((tagId: string) => ({ type: eventType, country: opts.country?.slice(0, 2).toUpperCase() || null, videoId: update.id, categoryId: update.categoryId || null, tagId })),
        ],
      }).catch(() => {});
    }

    return this.hydrateUrls(update);
  }

  async remove(id: string) {
    const video = await (this.prisma as any).video.findUnique({ where: { id } });
    if (!video) throw new BadRequestException('Video not found');
    await (this.prisma as any).video.delete({ where: { id } });
    return { ok: true };
  }

  private async hydrateUrls(video: any, managed = false) {
    const rawPlaylists = video?.VideoPlaylist || [];
    let user = video?.user || null;

    if (!user) {
      // Find admin user or first user to associate with videos created without userId
      const fallbackUser =
        (await (this.prisma as any).user.findFirst({
          where: { role: { name: 'ADMIN' } },
          select: {
            id: true,
            name: true,
            email: true,
            artistProfile: true,
          },
        })) ||
        (await (this.prisma as any).user.findFirst({
          select: {
            id: true,
            name: true,
            email: true,
            artistProfile: true,
          },
        }));

      if (fallbackUser) {
        user = fallbackUser;
        // Backfill userId in PostgreSQL DB asynchronously
        (this.prisma as any).video
          .update({
            where: { id: video.id },
            data: { userId: fallbackUser.id },
          })
          .catch(() => {});
      }
    }

    if (user) {
      if (!user.artistProfile) {
        let channel = await (this.prisma as any).artist.findFirst({
          where: { userId: user.id },
        });
        if (!channel) {
          channel = await (this.prisma as any).artist.create({
            data: {
              name: user.name || user.email.split('@')[0],
              userId: user.id,
            },
          });
        }
        user.artistProfile = channel;
      }

      if (user.artistProfile) {
        user = {
          ...user,
          artistProfile: {
            ...user.artistProfile,
            imageUrl: user.artistProfile.imageUrl
              ? await this.refreshUrl(user.artistProfile.imageUrl, 'images')
              : null,
            bannerUrl: user.artistProfile.bannerUrl
              ? await this.refreshUrl(user.artistProfile.bannerUrl, 'images')
              : null,
          },
        };
      }
    }

    const { mediaAsset, mediaAssetId, publishWhenReady, ...safeVideo } = video;
    const delivery = mediaAsset?.delivery;
    return {
      ...safeVideo,
      ...(managed ? { mediaAssetId, publishWhenReady } : {}),
      delivery: delivery ? { provider: delivery.provider, status: delivery.status } : null,
      user,
      videoUrl: delivery && !managed ? `pyramidplay:video:${video.id}` : (delivery && managed ? mediaAsset.fileUrl : video.videoUrl)
        ? await this.refreshUrl(delivery && managed ? mediaAsset.fileUrl : video.videoUrl, 'videos')
        : null,
      thumbnailUrl: video.thumbnailUrl
        ? await this.refreshUrl(video.thumbnailUrl, 'images')
        : null,
      videoPlaylists: rawPlaylists,
      category: video.videoCategory?.name || video.category,
      tags: video.videoTags?.length ? video.videoTags.map((item: any) => item.tag.name) : video.tags || [],
    };
  }

  private async resolveTaxonomy(category: unknown, tags: unknown) {
    const categoryName = typeof category === 'string' ? category.trim().replace(/\s+/g, ' ') : '';
    const normalizedCategory = categoryName.toLocaleLowerCase();
    const rawTags = Array.isArray(tags) ? tags : [];
    const uniqueTags = [...new Map(rawTags.filter((tag): tag is string => typeof tag === 'string').map((tag) => [tag.trim().toLocaleLowerCase(), tag.trim().replace(/\s+/g, ' ')])).values()].filter(Boolean).slice(0, 20);
    let categoryRecord: any = null;
    if (categoryName) {
      categoryRecord = await (this.prisma as any).videoCategory.upsert({
        where: { normalizedName: normalizedCategory },
        create: { name: categoryName, normalizedName: normalizedCategory },
        update: {},
      });
    }
    const tagRecords = await Promise.all(uniqueTags.map(async (name) => {
      const normalizedName = name.toLocaleLowerCase();
      return (this.prisma as any).videoTag.upsert({
        where: { normalizedName },
        create: { name, normalizedName, categoryId: categoryRecord?.id },
        update: categoryRecord ? { categoryId: categoryRecord.id } : {},
      });
    }));
    return { categoryName: categoryRecord?.name || null, categoryId: categoryRecord?.id || null, tags: tagRecords };
  }

  private refreshUrl(url: string | null | undefined, _bucket: 'videos' | 'images') {
    return this.minio.refreshUrl(url);
  }
}
