import { Injectable, ForbiddenException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGenreDto } from './dto/create-genre.dto';
import { UpdateGenreDto } from './dto/update-genre.dto';

@Injectable()
export class GenresService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    const defaults = [
      'Afrobeat',
      'Amapiano',
      'Hip-Hop',
      'Rap',
      'R&B',
      'Soul',
      'Jazz',
      'Gospel',
      'Pop',
      'Rock',
      'Reggae',
      'Dancehall',
      'Electro',
      'Classique',
      'Traditional',
    ];
    for (const name of defaults) {
      const exists = await this.prisma.genre.findUnique({ where: { name } });
      if (!exists) {
        await this.prisma.genre.create({ data: { name, isSystem: true } });
      }
    }
  }

  async create(createGenreDto: CreateGenreDto, user: any) {
    // If user is ADMIN, we respect isSystem if provided, otherwise default to true.
    // If user is not ADMIN, we force isSystem to false.
    const isSystem =
      user.role === 'ADMIN' ? (createGenreDto.isSystem ?? true) : false;
    return this.prisma.genre.create({
      data: {
        ...createGenreDto,
        createdById: user.userId,
        isSystem,
      },
    });
  }

  findAll() {
    return this.prisma.genre.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string) {
    return this.prisma.genre.findUnique({ where: { id } });
  }

  async update(id: string, updateGenreDto: UpdateGenreDto, user: any) {
    const genre = await this.prisma.genre.findUnique({ where: { id } });
    if (!genre) return null;

    if (user.role === 'ADMIN') {
      return this.prisma.genre.update({ where: { id }, data: updateGenreDto });
    }

    if (genre.isSystem) {
      throw new ForbiddenException('Cannot modify system genre');
    }

    if (genre.createdById !== user.userId) {
      throw new ForbiddenException(
        'Cannot modify genre created by another user',
      );
    }

    return this.prisma.genre.update({ where: { id }, data: updateGenreDto });
  }

  async remove(id: string, user: any) {
    const genre = await this.prisma.genre.findUnique({ where: { id } });
    if (!genre) return null;

    if (user.role === 'ADMIN') {
      return this.prisma.genre.delete({ where: { id } });
    }

    if (genre.isSystem) {
      throw new ForbiddenException('Cannot delete system genre');
    }

    if (genre.createdById !== user.userId) {
      throw new ForbiddenException(
        'Cannot delete genre created by another user',
      );
    }

    return this.prisma.genre.delete({ where: { id } });
  }
}
