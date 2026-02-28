/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSongDto } from './dto/create-song.dto';

@Injectable()
export class SongsService {
  constructor(private prisma: PrismaService) {}

  create(createSongDto: CreateSongDto) {
    const dto = createSongDto as unknown as Record<string, any>;
    const {
      artistIds,
      groupIds,
      artistId,
      isSingle,
      albumId,
      coverUrl,
      ...rest
    } = dto;
    const finalArtistIds: string[] = Array.isArray(artistIds)
      ? artistIds
      : artistId
        ? [artistId]
        : [];
    if (typeof isSingle !== 'boolean') {
      throw new BadRequestException('isSingle is required');
    }
    if (isSingle) {
      if (!coverUrl) {
        throw new BadRequestException('coverUrl is required for singles');
      }
      if (albumId) {
        throw new BadRequestException('Single cannot be linked to an album');
      }
    } else {
      if (!albumId) {
        throw new BadRequestException('albumId is required for album tracks');
      }
    }
    const data: any = {
      ...rest,
      isSingle,
      coverUrl: coverUrl || null,
      albumId: isSingle ? null : albumId,
      artists: { connect: finalArtistIds.map((id) => ({ id })) },
      ...(groupIds && groupIds.length
        ? { groups: { connect: groupIds.map((id) => ({ id })) } }
        : {}),
    };
    return this.prisma.song.create({
      data,
    });
  }

  findAll() {
    return this.prisma.song.findMany({
      include: { artists: true, groups: true, album: true, genre: true },
    });
  }

  findOne(id: string) {
    return this.prisma.song.findUnique({
      where: { id },
      include: { artists: true, groups: true, album: true, genre: true },
    });
  }

  update(id: string, updateSongDto: any) {
    const { artistIds, groupIds, isSingle, albumId, coverUrl, ...rest } =
      updateSongDto || {};
    const data: Record<string, any> = { ...rest };
    if (typeof isSingle === 'boolean') {
      data.isSingle = isSingle;
      if (isSingle) {
        if (!coverUrl) {
          throw new BadRequestException('coverUrl is required for singles');
        }
        data.coverUrl = coverUrl;
        data.albumId = null;
      } else {
        if (!albumId) {
          throw new BadRequestException('albumId is required for album tracks');
        }
        data.albumId = albumId;
        if (typeof coverUrl !== 'undefined') {
          data.coverUrl = coverUrl || null;
        }
      }
    } else {
      if (typeof albumId !== 'undefined') {
        data.albumId = albumId;
      }
      if (typeof coverUrl !== 'undefined') {
        data.coverUrl = coverUrl || null;
      }
    }
    const updateData: any = {
      ...data,
      ...(artistIds
        ? { artists: { set: artistIds.map((aid: string) => ({ id: aid })) } }
        : {}),
      ...(groupIds
        ? { groups: { set: groupIds.map((gid: string) => ({ id: gid })) } }
        : {}),
    };
    return this.prisma.song.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(id: string) {
    const song = await this.prisma.song.findUnique({
      where: { id },
      include: { album: true },
    });
    if (!song) {
      throw new BadRequestException('Song not found');
    }
    const albumId = song.albumId || null;
    const album = song.album;
    await this.prisma.song.delete({ where: { id } });
    let albumDeleted: typeof album = null;
    if (albumId) {
      const count = await this.prisma.song.count({ where: { albumId } });
      if (count === 0) {
        await this.prisma.album.delete({ where: { id: albumId } });
        albumDeleted = album;
      }
    }
    return { ok: true, albumDeleted };
  }
}
