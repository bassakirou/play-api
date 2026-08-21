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
      // Création automatique de la chaîne par défaut pour tout utilisateur avec un compte
      const channelName = (created.name || created.email.split('@')[0] || 'Chaîne').trim();
      const existingArtist = await this.prisma.artist.findUnique({
        where: { userId: created.id },
      });
      if (!existingArtist) {
        await this.prisma.artist.create({
          data: {
            name: channelName,
            userId: created.id,
          },
        });
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
      orderBy: { createdAt: 'desc' },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
        artistProfile: true,
      },
    });
  }

  count() {
    return this.prisma.user.count();
  }

  findOne(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
        artistProfile: true,
        favorites: true,
      },
    });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
        artistProfile: true,
      },
    });
  }

  findByResetToken(token: string) {
    return this.prisma.user.findFirst({
      where: { resetToken: token },
    });
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const dto = updateUserDto as unknown as Record<string, any>;
    const rawData: Record<string, any> = { ...dto };

    if (typeof dto.password === 'string' && dto.password.trim().length > 0) {
      const p = dto.password.trim();
      const looksHashed = p.startsWith('$2a$') || p.startsWith('$2b$') || p.startsWith('$2y$');
      rawData.password = looksHashed ? p : await bcrypt.hash(p, 10);
    } else {
      delete rawData.password;
    }

    if (typeof dto.role === 'string' && dto.role.trim().length > 0) {
      const roleName = dto.role.trim().toUpperCase();
      let role = await this.prisma.role.findUnique({ where: { name: roleName } });
      if (!role) {
        role = await this.prisma.role.create({ data: { name: roleName } });
      }
      rawData.roleId = role.id;
    }
    delete rawData.role;

    const allowedKeys = [
      'email',
      'password',
      'name',
      'systemRoles',
      'resetToken',
      'resetTokenExpiry',
      'roleId',
      'isEmailVerified',
      'verificationCode',
      'verificationCodeExpiry',
    ];
    const sanitizedData: Record<string, any> = {};
    for (const key of allowedKeys) {
      if (rawData[key] !== undefined) {
        sanitizedData[key] = rawData[key];
      }
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: sanitizedData,
      include: { role: true, artistProfile: true },
    });

    // Auto-synchronisation dans le catalogue des artistes si le rôle ARTIST est activé
    if (
      Array.isArray(sanitizedData.systemRoles) &&
      sanitizedData.systemRoles.includes('ARTIST')
    ) {
      const existingArtist = await this.prisma.artist.findUnique({
        where: { userId: id },
      });
      if (!existingArtist) {
        await this.prisma.artist.create({
          data: {
            name: (updated.name || updated.email.split('@')[0] || 'Artiste').trim(),
            userId: updated.id,
          },
        });
      }
    }

    return updated;
  }

  async updateSystemRoles(id: string, roles: string[], isSuperAdmin = false) {
    let validRoles = Array.isArray(roles) ? roles.map((r) => r.toUpperCase()) : [];
    if (!isSuperAdmin) {
      // Un utilisateur normal ne peut pas s'auto-attribuer SUPER_ADMIN
      const user = await this.prisma.user.findUnique({ where: { id } });
      const hadSuperAdmin = user?.systemRoles?.includes('SUPER_ADMIN');
      validRoles = validRoles.filter((r) => r !== 'SUPER_ADMIN');
      if (hadSuperAdmin) {
        validRoles.push('SUPER_ADMIN');
      }
    }

    return this.update(id, { systemRoles: validRoles } as any);
  }

  findAuthors() {
    return this.prisma.user.findMany({
      where: {
        systemRoles: {
          has: 'AUTHOR',
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  findCreators() {
    return this.prisma.user.findMany({
      where: {
        systemRoles: {
          has: 'CREATOR',
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
      orderBy: { name: 'asc' },
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
