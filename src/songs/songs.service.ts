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
      orderBy: { createdAt: 'desc' },
      include: { artists: true, groups: true, album: true, genre: true },
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
      include: { artists: true, groups: true, album: true, genre: true },
    });
    if (!s) return null;
    return {
      ...s,
      audioUrl: this.refreshUrl(s.audioUrl),
      coverUrl: this.refreshUrl(s.coverUrl),
    };
  }

  async incrementPlays(id: string) {
    try {
      await this.prisma.song.update({
        where: { id },
        data: { plays: { increment: 1 } },
      });
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  private refreshUrl(url: string | null | undefined) {
    return this.minio.refreshUrl(url);
  }

  async create(createSongDto: CreateSongDto, userId?: string) {
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

    const rawArtistIds: string[] = Array.isArray(artistIds)
      ? artistIds
      : artistId
        ? [artistId]
        : [];

    const rawGroupIds: string[] = Array.isArray(groupIds) ? groupIds : [];

    const rawGenreIds: string[] = Array.isArray(genreIds) && genreIds.length > 0
      ? genreIds
      : genreId
        ? [genreId]
        : [];

    const [existingArtists, existingGroups, existingGenres] = await Promise.all([
      rawArtistIds.length > 0
        ? this.prisma.artist.findMany({ where: { id: { in: rawArtistIds } }, select: { id: true } })
        : [],
      rawGroupIds.length > 0
        ? this.prisma.artistGroup.findMany({ where: { id: { in: rawGroupIds } }, select: { id: true } })
        : [],
      rawGenreIds.length > 0
        ? this.prisma.genre.findMany({ where: { id: { in: rawGenreIds } }, select: { id: true } })
        : [],
    ]);

    const finalArtistIds = existingArtists.map((a) => a.id);
    const finalGroupIds = existingGroups.map((g) => g.id);
    const finalGenreIds = existingGenres.map((g) => g.id);

    // Auto-link to creator's Artist profile if none specified
    if (finalArtistIds.length === 0 && finalGroupIds.length === 0 && userId) {
      let userArtist = await this.prisma.artist.findFirst({
        where: { userId },
      });
      if (!userArtist) {
        const u = await this.prisma.user.findUnique({ where: { id: userId } });
        if (u) {
          userArtist = await this.prisma.artist.create({
            data: {
              name: (u.name || u.email.split('@')[0] || 'Artiste').trim(),
              userId: u.id,
            },
          });
        }
      }
      if (userArtist) {
        finalArtistIds.push(userArtist.id);
      }
    }

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

    if (finalArtistIds.length === 0 && finalGroupIds.length === 0) {
      throw new BadRequestException('Au moins un artiste ou un groupe d’artistes valide est requis');
    }

    const primaryGenreId = finalGenreIds[0];

    const data: any = {
      title,
      duration: Number(duration),
      audioUrl,
      isSingle,
      coverUrl: coverUrl || null,
      ...(primaryGenreId ? { genre: { connect: { id: primaryGenreId } } } : {}),
      ...(finalGenreIds.length > 0
        ? { genres: { connect: finalGenreIds.map((gid) => ({ id: gid })) } }
        : {}),
      ...(isSingle ? {} : { album: { connect: { id: albumId } } }),
      ...(finalArtistIds.length > 0
        ? { artists: { connect: finalArtistIds.map((id) => ({ id })) } }
        : {}),
      ...(finalGroupIds.length > 0
        ? { groups: { connect: finalGroupIds.map((id) => ({ id })) } }
        : {}),
    };

    return this.prisma.song.create({
      data,
    });
  }

  async update(id: string, updateSongDto: any) {
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

    const rawGenreIds: string[] | undefined = Array.isArray(genreIds)
      ? genreIds
      : genreId
        ? [genreId]
        : undefined;

    if (rawGenreIds) {
      const existingGenres = await this.prisma.genre.findMany({
        where: { id: { in: rawGenreIds } },
        select: { id: true },
      });
      const validGenreIds = existingGenres.map((g) => g.id);
      if (validGenreIds.length > 0) {
        updateData.genre = { connect: { id: validGenreIds[0] } };
        updateData.genres = { set: validGenreIds.map((gid: string) => ({ id: gid })) };
      }
    }

    if (Array.isArray(artistIds)) {
      const existingArtists = artistIds.length > 0
        ? await this.prisma.artist.findMany({ where: { id: { in: artistIds } }, select: { id: true } })
        : [];
      updateData.artists = { set: existingArtists.map((a) => ({ id: a.id })) };
    }

    if (Array.isArray(groupIds)) {
      const existingGroups = groupIds.length > 0
        ? await this.prisma.artistGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true } })
        : [];
      updateData.groups = { set: existingGroups.map((g) => ({ id: g.id })) };
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
