/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
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
      const systemRoles = Array.isArray(createUserDto.systemRoles) ? [...createUserDto.systemRoles] : [];
      if (['ARTIST', 'AUTHOR', 'CREATOR', 'USER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName) && !systemRoles.includes(roleName)) {
        systemRoles.push(roleName);
      }

      const created = await this.prisma.user.create({
        data: {
          email: createUserDto.email,
          password: hashedPassword,
          name: createUserDto.name,
          roleId: role.id,
          systemRoles: systemRoles,
        },
      });

      // Création du profil Artiste UNIQUEMENT si l'utilisateur possède le rôle système ARTIST
      if (systemRoles.includes('ARTIST') || roleName === 'ARTIST') {
        const artistName = (created.name || created.email.split('@')[0] || 'Artiste').trim();
        const existingArtist = await this.prisma.artist.findUnique({
          where: { userId: created.id },
        });
        if (!existingArtist) {
          await this.prisma.artist.create({
            data: {
              name: artistName,
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

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
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

    if (user) {
      const currentSys = Array.isArray(user.systemRoles) ? [...user.systemRoles] : [];
      let changed = false;
      const roleName = (user.role?.name || '').toUpperCase();

      if (user.artistProfile && !currentSys.includes('ARTIST')) {
        currentSys.push('ARTIST');
        changed = true;
      }
      if (
        ['ARTIST', 'AUTHOR', 'CREATOR', 'ADMIN', 'SUPER_ADMIN'].includes(roleName) &&
        !currentSys.includes(roleName)
      ) {
        currentSys.push(roleName);
        changed = true;
      }

      if (changed) {
        try {
          await this.prisma.user.update({
            where: { id: user.id },
            data: { systemRoles: currentSys },
          });
          user.systemRoles = currentSys;
        } catch {
          // ignore background sync error
        }
      }
    }

    return user;
  }

  async findByEmail(email: string) {
    const user = await this.prisma.user.findUnique({
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

    if (user) {
      const currentSys = Array.isArray(user.systemRoles) ? [...user.systemRoles] : [];
      let changed = false;
      const roleName = (user.role?.name || '').toUpperCase();

      if (user.artistProfile && !currentSys.includes('ARTIST')) {
        currentSys.push('ARTIST');
        changed = true;
      }
      if (
        ['ARTIST', 'AUTHOR', 'CREATOR', 'ADMIN', 'SUPER_ADMIN'].includes(roleName) &&
        !currentSys.includes(roleName)
      ) {
        currentSys.push(roleName);
        changed = true;
      }

      if (changed) {
        try {
          await this.prisma.user.update({
            where: { id: user.id },
            data: { systemRoles: currentSys },
          });
          user.systemRoles = currentSys;
        } catch {
          // ignore background sync error
        }
      }
    }

    return user;
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

    if (sanitizedData.systemRoles !== undefined && Array.isArray(sanitizedData.systemRoles)) {
      let cleanRoles = Array.from(
        new Set(
          sanitizedData.systemRoles
            .filter((r: any) => typeof r === 'string' && r.trim().length > 0)
            .map((r: string) => r.trim().toUpperCase()),
        ),
      );
      const existingUser = await this.prisma.user.findUnique({
        where: { id },
        select: { systemRoles: true },
      });
      const hadSuperAdmin = existingUser?.systemRoles?.includes('SUPER_ADMIN');
      if (!hadSuperAdmin) {
        cleanRoles = cleanRoles.filter((r) => r !== 'SUPER_ADMIN');
      }
      sanitizedData.systemRoles = cleanRoles;
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: sanitizedData,
      include: { role: true, artistProfile: true },
    });

    // Auto-synchronisation des champs du profil artiste (avatar, bannière, bio, pays, socials)
    const hasArtistFields =
      dto.bio !== undefined ||
      dto.imageUrl !== undefined ||
      dto.bannerUrl !== undefined ||
      dto.country !== undefined ||
      dto.gallery !== undefined ||
      dto.name !== undefined;

    if (
      hasArtistFields ||
      (Array.isArray(sanitizedData.systemRoles) && sanitizedData.systemRoles.includes('ARTIST'))
    ) {
      await this.prisma.artist.upsert({
        where: { userId: id },
        create: {
          userId: id,
          name: (updated.name || updated.email.split('@')[0] || 'Artiste').trim(),
          bio: dto.bio || null,
          imageUrl: dto.imageUrl || null,
          bannerUrl: dto.bannerUrl || null,
          country: dto.country || null,
          gallery: typeof dto.gallery === 'object' ? JSON.stringify(dto.gallery) : dto.gallery || null,
        },
        update: {
          name: (updated.name || 'Artiste').trim(),
          ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
          ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
          ...(dto.bannerUrl !== undefined ? { bannerUrl: dto.bannerUrl } : {}),
          ...(dto.country !== undefined ? { country: dto.country } : {}),
          ...(dto.gallery !== undefined
            ? { gallery: typeof dto.gallery === 'object' ? JSON.stringify(dto.gallery) : dto.gallery }
            : {}),
        },
      });
    }

    return this.findOne(id);
  }

  async updateSystemRoles(id: string, roles: string[], isSuperAdmin = false) {
    let validRoles = Array.isArray(roles)
      ? Array.from(
          new Set(
            roles
              .filter((r: any) => typeof r === 'string' && r.trim().length > 0)
              .map((r) => r.trim().toUpperCase()),
          ),
        )
      : [];
    if (!isSuperAdmin) {
      // Un utilisateur normal ne peut pas s'auto-attribuer SUPER_ADMIN
      const user = await this.prisma.user.findUnique({ where: { id } });
      const hadSuperAdmin = user?.systemRoles?.includes('SUPER_ADMIN');
      validRoles = validRoles.filter((r) => r !== 'SUPER_ADMIN');
      if (hadSuperAdmin) {
        validRoles.push('SUPER_ADMIN');
      }
    }

    const updated = await this.update(id, { systemRoles: validRoles } as any);

    if (validRoles.includes('ARTIST')) {
      const u = await this.prisma.user.findUnique({ where: { id } });
      if (u) {
        const displayName = (u.name || u.email.split('@')[0] || 'Artiste').trim();
        await this.prisma.artist.upsert({
          where: { userId: id },
          create: {
            name: displayName,
            userId: id,
          },
          update: {
            name: displayName,
          },
        });
      }
    }

    return updated;
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

  async remove(id: string, requesterUserId?: string) {
    const targetUser = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!targetUser) throw new NotFoundException('Utilisateur non trouvé');

    const targetRole = (targetUser.role?.name || '').toUpperCase();
    const targetSystemRoles = Array.isArray(targetUser.systemRoles)
      ? targetUser.systemRoles.map((r) => r.toUpperCase())
      : [];

    // 1. Protection absolue du SUPER_ADMIN
    if (
      targetRole === 'SUPER_ADMIN' ||
      targetSystemRoles.includes('SUPER_ADMIN') ||
      targetUser.email.toLowerCase() === 'bassahakjm@gmail.com'
    ) {
      throw new ForbiddenException('Le compte SUPER_ADMIN est protégé et ne peut jamais être supprimé.');
    }

    // 2. Si la cible est un ADMIN, seul un SUPER_ADMIN peut le supprimer
    if (targetRole === 'ADMIN' || targetSystemRoles.includes('ADMIN')) {
      if (requesterUserId) {
        const requester = await this.prisma.user.findUnique({
          where: { id: requesterUserId },
          include: { role: true },
        });
        const reqRole = (requester?.role?.name || '').toUpperCase();
        const reqSys = Array.isArray(requester?.systemRoles)
          ? requester.systemRoles.map((r) => r.toUpperCase())
          : [];
        const isRequesterSuperAdmin =
          reqRole === 'SUPER_ADMIN' ||
          reqSys.includes('SUPER_ADMIN') ||
          requester?.email.toLowerCase() === 'bassahakjm@gmail.com';

        if (!isRequesterSuperAdmin) {
          throw new ForbiddenException('Seul un SUPER_ADMIN a le droit de supprimer un compte administrateur.');
        }
      }
    }

    // Supprimer le profil artiste lié s'il existe
    try {
      await this.prisma.artist.deleteMany({ where: { userId: id } });
    } catch {}

    return this.prisma.user.delete({ where: { id } });
  }
}
