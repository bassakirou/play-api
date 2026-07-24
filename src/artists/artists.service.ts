import { BadRequestException, Injectable, ForbiddenException } from '@nestjs/common';
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

  async findAll() {
    const artists = await this.prisma.artist.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        albums: true,
        songs: true,
        _count: {
          select: { followers: true },
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

  async findOne(id: string) {
    const artist = await this.prisma.artist.findUnique({
      where: { id },
      include: {
        albums: {
          include: { songs: true },
        },
        songs: {
          include: { artists: true, album: true },
        },
        _count: {
          select: { followers: true },
        },
      },
    });

    if (!artist) return null;

    // Get related artists (same genre from most recent songs)
    const genreIds = artist.songs.map((s) => s.genreId).filter((id): id is string => !!id);
    const relatedArtists = await this.prisma.artist.findMany({
      where: {
        id: { not: id },
        songs: {
          some: {
            genreId: { in: genreIds },
          },
        },
      },
      take: 5,
      include: {
        _count: {
          select: { followers: true },
        },
      },
    });

    const refreshedArtist = {
      ...artist,
      imageUrl: artist.imageUrl ? await this.refreshUrl(artist.imageUrl) : null,
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
    const artist = await this.prisma.artist.findUnique({
      where: { userId },
      include: {
        _count: { select: { followers: true } },
      },
    });
    if (!artist) return null;

    return {
      ...artist,
      imageUrl: artist.imageUrl ? await this.refreshUrl(artist.imageUrl) : null,
      bannerUrl: artist.bannerUrl ? await this.refreshUrl(artist.bannerUrl) : null,
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

  remove(id: string) {
    return this.prisma.artist.delete({ where: { id } });
  }
}
