/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    // Find role
    const roleName = (createUserDto.role || 'USER').toUpperCase();
    let role = await this.prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      role = await this.prisma.role.create({ data: { name: roleName } });
    }

    try {
      const created = await this.prisma.user.create({
        data: {
          email: createUserDto.email,
          password: hashedPassword,
          name: createUserDto.name,
          roleId: role.id,
        },
      });
      if (roleName === 'CREATOR') {
        const existingArtist = await this.prisma.artist.findUnique({
          where: { userId: created.id },
        });
        if (!existingArtist) {
          await this.prisma.artist.create({
            data: {
              name: created.name,
              userId: created.id,
            },
          });
        }
      }
      return created;
    } catch (err: any) {
      const code = err?.code;
      if (code === 'P2002') {
        throw new BadRequestException('Email already exists');
      }
      if (code === 'P2003') {
        throw new BadRequestException('Invalid role');
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  findAll() {
    return this.prisma.user.findMany({
      include: { role: true, artistProfile: true },
    });
  }

  count() {
    return this.prisma.user.count();
  }

  findOne(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { role: true, artistProfile: true, favorites: true },
    });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });
  }

  findByResetToken(token: string) {
    return this.prisma.user.findFirst({
      where: { resetToken: token },
    });
  }

  update(id: string, updateUserDto: any) {
    return this.prisma.user.update({
      where: { id },
      data: updateUserDto,
    });
  }

  remove(id: string) {
    return this.prisma.user.delete({ where: { id } });
  }

  // Favorites Management
  async addFavorite(userId: string, songId: string) {
    const song = await this.prisma.song.findUnique({ where: { id: songId } });
    if (!song) {
      throw new NotFoundException('Song not found');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        favorites: {
          connect: { id: songId },
        },
      },
      include: { favorites: true },
    });
  }

  async removeFavorite(userId: string, songId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        favorites: {
          disconnect: { id: songId },
        },
      },
      include: { favorites: true },
    });
  }

  async getFavorites(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { favorites: { include: { artists: true, album: true } } },
    });
    return user?.favorites || [];
  }

  // Follow Artists Management
  async followArtist(userId: string, artistId: string) {
    const artist = await this.prisma.artist.findUnique({
      where: { id: artistId },
    });
    if (!artist) {
      throw new NotFoundException('Artist not found');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        followingArtists: {
          connect: { id: artistId },
        },
      },
      include: { followingArtists: true },
    });
  }

  async unfollowArtist(userId: string, artistId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        followingArtists: {
          disconnect: { id: artistId },
        },
      },
      include: { followingArtists: true },
    });
  }

  async getFollowing(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { followingArtists: true },
    });
    return user?.followingArtists || [];
  }
}
