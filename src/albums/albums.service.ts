import { accessPeriodFields } from '../content-access/access-period';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAlbumDto } from './dto/create-album.dto';
import { MinioService } from '../storage/minio.service';

@Injectable()
export class AlbumsService {
  constructor(
    private prisma: PrismaService,
    private minio: MinioService,
  ) {}

  async create(createAlbumDto: CreateAlbumDto, publisherId: string) {
    const {
      title,
      year,
      coverUrl,
      description,
      artistId,
      artistIds,
      groupIds,
      isAcademic,
      isMonetized,
      price,
      discountPrice,
    } = createAlbumDto as any;
    const finalArtistId =
      artistId || (artistIds && artistIds.length ? artistIds[0] : null);
    const data: any = {
      ...accessPeriodFields(createAlbumDto),
      publisher: { connect: { id: publisherId } },
      title,
      year: Number(year),
      coverUrl: coverUrl || null,
      description: description || null,
      isAcademic: Boolean(isAcademic),
      isMonetized: Boolean(isMonetized),
      price:
        isMonetized && price !== null && price !== undefined
          ? Number(price)
          : 0,
      discountPrice:
        isMonetized && discountPrice !== null && discountPrice !== undefined
          ? Number(discountPrice)
          : null,
      ...(finalArtistId ? { artist: { connect: { id: finalArtistId } } } : {}),
      ...(groupIds && groupIds.length
        ? { groups: { connect: groupIds.map((gid: string) => ({ id: gid })) } }
        : {}),
    };
    return this.prisma.album.create({
      data,
      include: { artist: true, groups: true },
    });
  }

  async findAll(isAcademic?: boolean, caller?: { id: string; role?: string }) {
    const where: any = {};
    if (caller && !['ADMIN', 'SUPER_ADMIN'].includes(caller.role || '')) {
      where.artist = { userId: caller.id || '__unauthorized__' };
    }
    if (isAcademic !== undefined) {
      where.isAcademic = isAcademic;
    }

    const albums = await this.prisma.album.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        artist: caller ? { include: { user: { select: { email: true } } } } : true,
        groups: true,
        songs: {
          include: {
            groups: true,
            artists: true,
          },
        },
      },
    });
    return Promise.all(
      albums.map(async (a) => ({
        ...a,
        ...(caller ? { creatorEmails: (a.artist as any)?.user?.email ? [(a.artist as any).user.email] : [] } : {}),
        coverUrl: a.coverUrl ? await this.refreshUrl(a.coverUrl) : null,
      })),
    );
  }

  async findOne(id: string) {
    const a = await this.prisma.album.findUnique({
      where: { id },
      include: {
        artist: true,
        groups: true,
        songs: {
          include: {
            groups: true,
            artists: true,
          },
        },
      },
    });
    if (!a) return null;
    return {
      ...a,
      coverUrl: a.coverUrl ? await this.refreshUrl(a.coverUrl) : null,
    };
  }

  private refreshUrl(url: string | null | undefined) {
    return this.minio.refreshUrl(url);
  }

  update(id: string, updateAlbumDto: any) {
    const editableFields = ['title', 'year', 'coverUrl', 'description', 'artistId', 'isAcademic', 'isMonetized', 'price', 'discountPrice'];
    const data: Prisma.AlbumUncheckedUpdateInput = {
      ...accessPeriodFields(updateAlbumDto),
      ...Object.fromEntries(editableFields.filter((key) => updateAlbumDto[key] !== undefined)
        .map((key) => [key, updateAlbumDto[key]])),
      ...(Array.isArray(updateAlbumDto.groupIds)
        ? { groups: { set: updateAlbumDto.groupIds.filter((id: unknown) => typeof id === 'string').map((id: string) => ({ id })) } }
        : {}),
    };
    if (typeof data.isAcademic !== 'undefined') {
      data.isAcademic = Boolean(data.isAcademic);
    }
    if (typeof data.isMonetized !== 'undefined') {
      data.isMonetized = Boolean(data.isMonetized);
    }
    if (typeof data.price !== 'undefined') {
      data.price = data.price !== null ? Number(data.price) : 0;
    }
    if (typeof data.discountPrice !== 'undefined') {
      data.discountPrice =
        data.discountPrice !== null ? Number(data.discountPrice) : null;
    }
    return this.prisma.album.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.song.deleteMany({ where: { albumId: id } });
      return tx.album.delete({ where: { id } });
    });
  }
}
