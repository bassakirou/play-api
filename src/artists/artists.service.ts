import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateArtistDto } from './dto/create-artist.dto';

@Injectable()
export class ArtistsService {
  constructor(private prisma: PrismaService) {}

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

  findAll() {
    return this.prisma.artist.findMany({
      include: { 
        albums: true, 
        songs: true,
        _count: {
          select: { followers: true }
        }
      },
    });
  }

  findCreators() {
    return this.prisma.artist.findMany({
      where: { user: { role: { name: 'CREATOR' } } },
      include: { user: true },
    });
  }

  async findOne(id: string) {
    const artist = await this.prisma.artist.findUnique({
      where: { id },
      include: { 
        albums: {
          include: { songs: true }
        }, 
        songs: {
          include: { artists: true, album: true }
        },
        _count: {
          select: { followers: true }
        }
      },
    });

    if (!artist) return null;

    // Get related artists (same genre from most recent songs)
    const genreIds = artist.songs.map(s => s.genreId);
    const relatedArtists = await this.prisma.artist.findMany({
      where: {
        id: { not: id },
        songs: {
          some: {
            genreId: { in: genreIds }
          }
        }
      },
      take: 5,
      include: {
        _count: {
          select: { followers: true }
        }
      }
    });

    return {
      ...artist,
      relatedArtists
    };
  }

  async follow(artistId: string, userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        followingArtists: {
          connect: { id: artistId }
        }
      }
    });
  }

  async unfollow(artistId: string, userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        followingArtists: {
          disconnect: { id: artistId }
        }
      }
    });
  }

  async isFollowing(artistId: string, userId: string) {
    const count = await this.prisma.artist.count({
      where: {
        id: artistId,
        followers: {
          some: { id: userId }
        }
      }
    });
    return count > 0;
  }

  async update(id: string, updateArtistDto: any, user: any) {
    // Check ownership or admin rights
    const { 
      certified, 
      birthDate, 
      gallery,
      ...rest 
    } = updateArtistDto;

    const data: any = { ...rest };

    if (certified !== undefined) {
      data.certified = certified === 'true' || certified === true;
    }

    if (birthDate) {
      data.birthDate = new Date(birthDate);
    }

    if (gallery !== undefined) {
      data.gallery = typeof gallery === 'string' ? gallery : JSON.stringify(gallery);
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
