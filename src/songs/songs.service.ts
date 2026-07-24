/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSongDto } from './dto/create-song.dto';
import { MinioService } from '../storage/minio.service';

@Injectable()
export class SongsService {
  constructor(
    private prisma: PrismaService,
    private minio: MinioService,
  ) {}

  async findAll() {
    const songs = await this.prisma.song.findMany({
      include: { artists: true, groups: true, album: true, genre: true, genres: true },
    });
    return songs.map((s) => ({
      ...s,
      audioUrl: this.refreshUrl(s.audioUrl),
      coverUrl: this.refreshUrl(s.coverUrl),
    }));
  }

  async findOne(id: string) {
    const s = await this.prisma.song.findUnique({
      where: { id },
      include: { artists: true, groups: true, album: true, genre: true, genres: true },
    });
    if (!s) return null;
    return {
      ...s,
      audioUrl: this.refreshUrl(s.audioUrl),
      coverUrl: this.refreshUrl(s.coverUrl),
    };
  }

  private refreshUrl(url: string | null | undefined) {
    return this.minio.refreshUrl(url);
  }

  create(createSongDto: CreateSongDto) {
    const dto = createSongDto as unknown as Record<string, any>;
    const {
      title,
      duration,
      audioUrl,
      artistIds,
      groupIds,
      artistId,
      isSingle: rawIsSingle,
      albumId,
      coverUrl,
      genreId,
      genreIds,
    } = dto;

    const finalArtistIds: string[] = Array.isArray(artistIds)
      ? artistIds
      : artistId
        ? [artistId]
        : [];

    const finalGenreIds: string[] = Array.isArray(genreIds) && genreIds.length > 0
      ? genreIds
      : genreId
        ? [genreId]
        : [];

    const isSingle = albumId ? false : (rawIsSingle ?? true);

    if (isSingle) {
      if (!coverUrl) {
        throw new BadRequestException('coverUrl is required for singles');
      }
    } else {
      if (!albumId) {
        throw new BadRequestException('albumId is required for album tracks');
      }
    }

    if (finalGenreIds.length === 0) {
      throw new BadRequestException('genreId or genreIds is required');
    }

    const primaryGenreId = finalGenreIds[0];

    const data: any = {
      title,
      duration: Number(duration),
      audioUrl,
      isSingle,
      coverUrl: coverUrl || null,
      ...(primaryGenreId ? { genre: { connect: { id: primaryGenreId } } } : {}),
      genres: { connect: finalGenreIds.map((gid) => ({ id: gid })) },
      ...(isSingle ? {} : { album: { connect: { id: albumId } } }),
      ...(finalArtistIds.length > 0
        ? { artists: { connect: finalArtistIds.map((id) => ({ id })) } }
        : {}),
      ...(groupIds && groupIds.length > 0
        ? { groups: { connect: groupIds.map((id) => ({ id })) } }
        : {}),
    };

    return this.prisma.song.create({
      data,
    });
  }

  update(id: string, updateSongDto: any) {
    const {
      title,
      duration,
      audioUrl,
      artistIds,
      groupIds,
      isSingle: rawIsSingle,
      albumId,
      coverUrl,
      genreId,
      genreIds,
    } = updateSongDto || {};

    const cleanAlbumId =
      typeof albumId === 'string' && albumId.trim() !== '' ? albumId : null;
    const isSingle = cleanAlbumId
      ? false
      : typeof rawIsSingle === 'boolean'
        ? rawIsSingle
        : true;

    const updateData: any = {};

    if (typeof title !== 'undefined') updateData.title = title;
    if (typeof duration !== 'undefined') updateData.duration = Number(duration);
    if (typeof audioUrl !== 'undefined') updateData.audioUrl = audioUrl;
    updateData.isSingle = isSingle;

    if (typeof coverUrl !== 'undefined') {
      updateData.coverUrl = coverUrl || null;
    }

    if (isSingle) {
      updateData.album = { disconnect: true };
    } else if (cleanAlbumId) {
      updateData.album = { connect: { id: cleanAlbumId } };
    }

    const finalGenreIds: string[] | undefined = Array.isArray(genreIds)
      ? genreIds
      : genreId
        ? [genreId]
        : undefined;

    if (finalGenreIds && finalGenreIds.length > 0) {
      updateData.genre = { connect: { id: finalGenreIds[0] } };
      updateData.genres = { set: finalGenreIds.map((gid: string) => ({ id: gid })) };
    }

    if (Array.isArray(artistIds)) {
      updateData.artists = { set: artistIds.map((aid: string) => ({ id: aid })) };
    }

    if (Array.isArray(groupIds)) {
      updateData.groups = { set: groupIds.map((gid: string) => ({ id: gid })) };
    }

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
