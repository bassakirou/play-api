import { BadRequestException, Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateArtistDto } from './dto/create-artist.dto';
import { MinioService } from '../storage/minio.service';

@Injectable()
export class ArtistsService {
  constructor(
    private prisma: PrismaService,
    private minio: MinioService,
  ) {}

  async create(createArtistDto: CreateArtistDto, user: any) {
    const { certified, ...data } = createArtistDto;
    if (user.role === 'CREATOR') {
      // Creator can only create their own profile
      const existing = await this.prisma.artist.findUnique({
        where: { userId: user.userId },
      });
      if (existing) {
        throw new ForbiddenException('You already have an artist profile');
      }
      return this.prisma.artist.create({
        data: {
          ...data,
          certified: certified ?? false,
          userId: user.userId,
        },
      });
    } else if (user.role === 'LABEL') {
      // Label creates artist managed by them
      return this.prisma.artist.create({
        data: {
          ...data,
          certified: certified ?? false,
          labelId: user.userId,
        },
      });
    } else if (user.role === 'ADMIN') {
      return this.prisma.artist.create({
        data: {
          ...data,
          certified: certified ?? false,
        },
      });
    }

    throw new ForbiddenException('Not authorized to create artist');
  }

  async findAll(type?: string) {
    // 1. Auto-synchronisation des utilisateurs ayant explicitement le rôle système ARTIST
    try {
      const usersWithArtistRole = await this.prisma.user.findMany({
        where: {
          OR: [
            { systemRoles: { has: 'ARTIST' } },
            { role: { name: 'ARTIST' } },
          ],
        },
        include: {
          artistProfile: true,
        },
      });

      for (const u of usersWithArtistRole) {
        const displayName = (u.name || u.email.split('@')[0] || 'Artiste').trim();
        if (!u.artistProfile) {
          await this.prisma.artist.create({
            data: {
              name: displayName,
              userId: u.id,
            },
          });
        } else if (u.name && u.artistProfile.name !== u.name.trim()) {
          await this.prisma.artist.update({
            where: { id: u.artistProfile.id },
            data: { name: u.name.trim() },
          });
        }
      }
    } catch {
      // ignore sync errors
    }

    // 2. Nettoyage automatique des profils orphelins non-artistes sans œuvres
    try {
      const nonArtistOrphans = await this.prisma.artist.findMany({
        where: {
          userId: { not: null },
          user: {
            AND: [
              { NOT: { systemRoles: { has: 'ARTIST' } } },
              { role: { name: { not: 'ARTIST' } } },
            ],
          },
          songs: { none: {} },
          albums: { none: {} },
        },
      });
      if (nonArtistOrphans.length > 0) {
        await this.prisma.artist.deleteMany({
          where: { id: { in: nonArtistOrphans.map((a) => a.id) } },
        });
      }
    } catch {}

    const artists = await this.prisma.artist.findMany({
      where:
        type === 'catalog'
          ? { userId: null }
          : type === 'channel'
          ? {
              userId: { not: null },
              user: {
                OR: [
                  { systemRoles: { has: 'ARTIST' } },
                  { role: { name: 'ARTIST' } },
                ],
              },
            }
          : {
              OR: [
                { userId: null }, // Artistes du catalogue (administrateur)
                {
                  userId: { not: null },
                  user: {
                    OR: [
                      { systemRoles: { has: 'ARTIST' } },
                      { role: { name: 'ARTIST' } },
                    ],
                  },
                },
              ],
            },
      orderBy: { createdAt: 'desc' },
      include: {
        user: true,
        albums: {
          include: {
            songs: true,
          },
        },
        songs: true,
        groups: true,
        _count: {
          select: { followers: true, songs: true },
        },
      },
    });
    return Promise.all(
      artists.map(async (a) => ({
        ...a,
        imageUrl: a.imageUrl ? await this.refreshUrl(a.imageUrl) : null,
      })),
    );
  }

  async findAllChannels() {
    const channels = await this.prisma.artist.findMany({
      where: { userId: { not: null } },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: { select: { name: true } },
          },
        },
        _count: {
          select: { followers: true },
        },
      },
    });

    const videoCounts = await this.prisma.video.groupBy({
      by: ['userId'],
      _count: { id: true },
    });
    const videoCountMap = new Map<string, number>();
    videoCounts.forEach((vc: any) => {
      if (vc.userId) {
        videoCountMap.set(vc.userId, vc._count.id);
      }
    });

    return Promise.all(
      channels.map(async (c) => ({
        ...c,
        imageUrl: c.imageUrl ? await this.refreshUrl(c.imageUrl) : null,
        bannerUrl: c.bannerUrl ? await this.refreshUrl(c.bannerUrl) : null,
        videoCount: c.userId ? videoCountMap.get(c.userId) || 0 : 0,
      })),
    );
  }

  async findPopular() {
    // Only return artists with at least 1 song
    const artists = await this.prisma.artist.findMany({
      where: {
        songs: {
          some: {},
        },
      },
      include: {
        albums: {
          include: { songs: true },
        },
        songs: {
          include: {
            _count: {
              select: { favoritedBy: true },
            },
          },
        },
        _count: {
          select: { followers: true },
        },
      },
    });

    const scoredArtists = artists.map((a: any) => {
      const totalPlays = (a.songs || []).reduce((sum: number, s: any) => sum + (s.plays || 0), 0);
      const totalSongLikes = (a.songs || []).reduce(
        (sum: number, s: any) => sum + (s._count?.favoritedBy || 0),
        0,
      );
      const followersCount = a._count?.followers || 0;
      const profileViews = a.views || 0;

      // Popularity score formula: (Plays * 3) + (Followers * 2) + (Likes * 2) + (Views * 1)
      const popularityScore =
        totalPlays * 3 + followersCount * 2 + totalSongLikes * 2 + profileViews * 1;

      return {
        ...a,
        popularityScore,
        followersCount,
      };
    });

    // Sort descending by popularityScore, tie-break by total songs desc, then createdAt desc
    scoredArtists.sort((a: any, b: any) => {
      if (b.popularityScore !== a.popularityScore) {
        return b.popularityScore - a.popularityScore;
      }
      if (b.songs.length !== a.songs.length) {
        return b.songs.length - a.songs.length;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return Promise.all(
      scoredArtists.map(async (a: any) => ({
        ...a,
        imageUrl: a.imageUrl ? await this.refreshUrl(a.imageUrl) : null,
      })),
    );
  }

  async incrementViews(id: string) {
    try {
      await this.prisma.artist.update({
        where: { id },
        data: { views: { increment: 1 } },
      });
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  async findOne(id: string) {
    void this.incrementViews(id);

    const artist = await this.prisma.artist.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: { select: { name: true } },
            systemRoles: true,
          },
        },
        albums: {
          include: { songs: true },
        },
        songs: {
          include: { artists: true, album: true, genre: true },
        },
        _count: {
          select: { followers: true },
        },
      },
    });

    if (!artist) return null;

    const isCreator =
      artist.user?.role?.name === 'CREATOR' ||
      (artist.user?.systemRoles || []).includes('CREATOR');

    // Fetch artist videos
    const videos = await this.prisma.video.findMany({
      where: {
        isPublished: true,
        OR: [
          { artists: { some: { id } } },
          ...(artist.userId ? [{ userId: artist.userId }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch artist audiobooks
    const audiobooks = await this.prisma.audiobook.findMany({
      where: {
        OR: [
          { author: { equals: artist.name, mode: 'insensitive' } },
          ...(artist.userId ? [{ authorId: artist.userId }] : []),
        ],
      },
      include: {
        chapters: {
          select: { id: true, title: true, duration: true, order: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get related artists (same genre from most recent songs)
    const genreIds = artist.songs
      .map((s) => s.genreId)
      .filter((id): id is string => !!id);
    const relatedArtists = await this.prisma.artist.findMany({
      where: {
        id: { not: id },
        songs: {
          some: {
            genreId: { in: genreIds },
          },
        },
      },
      take: 6,
      include: {
        _count: {
          select: { followers: true },
        },
      },
    });

    const refreshedArtist = {
      ...artist,
      isCreator,
      videos: await Promise.all(
        videos.map(async (v) => ({
          ...v,
          thumbnailUrl: v.thumbnailUrl
            ? await this.refreshUrl(v.thumbnailUrl)
            : null,
          videoUrl: v.videoUrl ? await this.refreshUrl(v.videoUrl) : null,
        })),
      ),
      audiobooks: await Promise.all(
        audiobooks.map(async (ab) => ({
          ...ab,
          coverUrl: ab.coverUrl ? await this.refreshUrl(ab.coverUrl) : null,
        })),
      ),
      imageUrl: artist.imageUrl ? await this.refreshUrl(artist.imageUrl) : null,
      bannerUrl: artist.bannerUrl
        ? await this.refreshUrl(artist.bannerUrl)
        : null,
      relatedArtists: await Promise.all(
        relatedArtists.map(async (ra) => ({
          ...ra,
          imageUrl: ra.imageUrl ? await this.refreshUrl(ra.imageUrl) : null,
        })),
      ),
    };

    return refreshedArtist;
  }

  async findMyChannel(userId: string) {
    let artist = await this.prisma.artist.findUnique({
      where: { userId },
      include: {
        _count: { select: { followers: true } },
      },
    });

    if (!artist) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        const channelName = (user.name || user.email.split('@')[0] || 'Chaîne').trim();
        artist = await this.prisma.artist.create({
          data: {
            name: channelName,
            userId: user.id,
          },
          include: {
            _count: { select: { followers: true } },
          },
        });
      }
    }

    if (!artist) return null;

    return {
      ...artist,
      imageUrl: artist.imageUrl ? await this.refreshUrl(artist.imageUrl) : null,
      bannerUrl: artist.bannerUrl ? await this.refreshUrl(artist.bannerUrl) : null,
    };
  }

  async createChannelForUser(dto: {
    userId: string;
    name?: string;
    bio?: string;
    imageUrl?: string;
    bannerUrl?: string;
    certified?: boolean;
  }) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable');
    }
    const existing = await this.prisma.artist.findUnique({ where: { userId: dto.userId } });
    const channelName = (dto.name || user.name || user.email.split('@')[0] || 'Chaîne').trim();

    if (existing) {
      const updated = await this.prisma.artist.update({
        where: { id: existing.id },
        data: {
          name: channelName,
          ...(typeof dto.bio !== 'undefined' ? { bio: dto.bio || null } : {}),
          ...(typeof dto.imageUrl !== 'undefined' ? { imageUrl: dto.imageUrl || null } : {}),
          ...(typeof dto.bannerUrl !== 'undefined' ? { bannerUrl: dto.bannerUrl || null } : {}),
          ...(typeof dto.certified !== 'undefined' ? { certified: !!dto.certified } : {}),
        },
        include: {
          user: {
            select: { id: true, name: true, email: true, role: { select: { name: true } } },
          },
          _count: { select: { followers: true } },
        },
      });
      return {
        ...updated,
        imageUrl: updated.imageUrl ? await this.refreshUrl(updated.imageUrl) : null,
        bannerUrl: updated.bannerUrl ? await this.refreshUrl(updated.bannerUrl) : null,
      };
    }

    const created = await this.prisma.artist.create({
      data: {
        name: channelName,
        bio: dto.bio || null,
        imageUrl: dto.imageUrl || null,
        bannerUrl: dto.bannerUrl || null,
        certified: !!dto.certified,
        userId: dto.userId,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, role: { select: { name: true } } },
        },
        _count: { select: { followers: true } },
      },
    });

    return {
      ...created,
      imageUrl: created.imageUrl ? await this.refreshUrl(created.imageUrl) : null,
      bannerUrl: created.bannerUrl ? await this.refreshUrl(created.bannerUrl) : null,
      videoCount: 0,
    };
  }

  async upsertMyChannel(userId: string, dto: CreateArtistDto) {
    const name = (dto?.name || '').trim();
    if (!name) throw new BadRequestException('name is required');

    const artist = await this.prisma.artist.upsert({
      where: { userId },
      create: {
        name,
        bio: dto.bio || null,
        imageUrl: dto.imageUrl || null,
        bannerUrl: dto.bannerUrl || null,
        gallery: dto.gallery || null,
        certified: !!dto.certified,
        userId,
      },
      update: {
        name,
        bio: dto.bio || null,
        imageUrl: dto.imageUrl || null,
        bannerUrl: dto.bannerUrl || null,
        gallery: dto.gallery || null,
      },
      include: {
        _count: { select: { followers: true } },
      },
    });

    return {
      ...artist,
      imageUrl: artist.imageUrl ? await this.refreshUrl(artist.imageUrl) : null,
      bannerUrl: artist.bannerUrl ? await this.refreshUrl(artist.bannerUrl) : null,
    };
  }

  async updateMyChannel(userId: string, dto: any) {
    const existing = await this.prisma.artist.findUnique({ where: { userId } });
    if (!existing) throw new BadRequestException('No channel to update');

    const data: any = {};
    if (typeof dto?.name === 'string') data.name = dto.name.trim();
    if (typeof dto?.bio !== 'undefined') data.bio = dto.bio || null;
    if (typeof dto?.imageUrl !== 'undefined') data.imageUrl = dto.imageUrl || null;
    if (typeof dto?.bannerUrl !== 'undefined') data.bannerUrl = dto.bannerUrl || null;
    if (typeof dto?.gallery !== 'undefined') data.gallery = dto.gallery || null;

    const updated = await this.prisma.artist.update({
      where: { userId },
      data,
      include: {
        _count: { select: { followers: true } },
      },
    });

    return {
      ...updated,
      imageUrl: updated.imageUrl ? await this.refreshUrl(updated.imageUrl) : null,
      bannerUrl: updated.bannerUrl ? await this.refreshUrl(updated.bannerUrl) : null,
    };
  }

  private refreshUrl(url: string | null | undefined) {
    return this.minio.refreshUrl(url);
  }

  findCreators() {
    return this.prisma.artist.findMany({
      where: { user: { role: { name: 'CREATOR' } } },
      include: { user: true },
    });
  }

  async follow(artistId: string, userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        followingArtists: {
          connect: { id: artistId },
        },
      },
    });
  }

  async unfollow(artistId: string, userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        followingArtists: {
          disconnect: { id: artistId },
        },
      },
    });
  }

  async isFollowing(artistId: string, userId: string) {
    const count = await this.prisma.artist.count({
      where: {
        id: artistId,
        followers: {
          some: { id: userId },
        },
      },
    });
    return count > 0;
  }

  async update(id: string, updateArtistDto: any, user: any) {
    // Check ownership or admin rights
    const { certified, birthDate, gallery, ...rest } = updateArtistDto;

    const data: any = { ...rest };

    if (certified !== undefined) {
      data.certified = certified === 'true' || certified === true;
    }

    if (birthDate) {
      data.birthDate = new Date(birthDate);
    }

    if (gallery !== undefined) {
      data.gallery =
        typeof gallery === 'string' ? gallery : JSON.stringify(gallery);
    }

    return this.prisma.artist.update({
      where: { id },
      data,
    });
  }

  async cleanupStaleUserArtists() {
    // Find all artists linked to a user whose role is not CREATOR
    // and who have 0 songs, 0 albums, 0 videos, 0 groups
    const staleArtists = await this.prisma.artist.findMany({
      where: {
        userId: { not: null },
        user: {
          role: {
            name: { not: 'CREATOR' },
          },
        },
        songs: { none: {} },
        albums: { none: {} },
        videos: { none: {} },
        groups: { none: {} },
      },
      select: {
        id: true,
        name: true,
        userId: true,
      },
    });

    if (staleArtists.length === 0) {
      return { count: 0, deleted: [] };
    }

    const idsToDelete = staleArtists.map((a) => a.id);
    await this.prisma.artist.deleteMany({
      where: { id: { in: idsToDelete } },
    });

    return {
      count: idsToDelete.length,
      deleted: staleArtists,
    };
  }

  remove(id: string) {
    return this.prisma.artist.delete({ where: { id } });
  }
}
