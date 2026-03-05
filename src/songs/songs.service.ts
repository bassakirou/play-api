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
      include: { artists: true, groups: true, album: true, genre: true },
    });
    return Promise.all(
      songs.map(async (s) => ({
        ...s,
        audioUrl: s.audioUrl
          ? await this.refreshUrl(s.audioUrl, 'audio')
          : null,
        coverUrl: s.coverUrl
          ? await this.refreshUrl(s.coverUrl, 'images')
          : null,
      })),
    );
  }

  async findOne(id: string) {
    const s = await this.prisma.song.findUnique({
      where: { id },
      include: { artists: true, groups: true, album: true, genre: true },
    });
    if (!s) return null;
    return {
      ...s,
      audioUrl: s.audioUrl ? await this.refreshUrl(s.audioUrl, 'audio') : null,
      coverUrl: s.coverUrl ? await this.refreshUrl(s.coverUrl, 'images') : null,
    };
  }

  private async refreshUrl(url: string, bucket: 'audio' | 'images') {
    if (!url) return url;

    // 1. URLs Vercel Blob : Pas de rafraîchissement
    if (url.includes('public.blob.vercel-storage.com')) return url;

    // 2. URLs Minio : On rafraîchit si Minio est actif
    if (
      this.minio.isEnabled() &&
      (url.includes(`/${bucket}/`) || url.includes('?'))
    ) {
      try {
        const u = new URL(url);
        const objectName = u.pathname.split('/').pop();
        if (!objectName) return url;
        return await this.minio.presignGet({ bucket, objectName });
      } catch {
        return url;
      }
    }

    return url;
  }

  create(createSongDto: CreateSongDto) {
    const dto = createSongDto as unknown as Record<string, any>;
    const {
      artistIds,
      groupIds,
      artistId,
      isSingle: rawIsSingle,
      albumId,
      coverUrl,
      ...rest
    } = dto;
    const finalArtistIds: string[] = Array.isArray(artistIds)
      ? artistIds
      : artistId
        ? [artistId]
        : [];

    // Détermination intelligente de isSingle
    // Si un albumId est présent, ce n'est PAS un single, peu importe ce que dit le front
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

  update(id: string, updateSongDto: any) {
    const {
      artistIds,
      groupIds,
      isSingle: rawIsSingle,
      albumId,
      coverUrl,
      ...rest
    } = updateSongDto || {};

    const data: Record<string, any> = { ...rest };

    // Détermination intelligente de isSingle pour la mise à jour
    let isSingle = rawIsSingle;
    if (typeof albumId !== 'undefined' && albumId !== null) {
      isSingle = false;
    }

    if (typeof isSingle === 'boolean') {
      data.isSingle = isSingle;
      if (isSingle) {
        if (!coverUrl && typeof coverUrl !== 'undefined') {
          throw new BadRequestException('coverUrl is required for singles');
        }
        data.albumId = null;
      } else {
        if (typeof albumId !== 'undefined') {
          data.albumId = albumId;
        }
      }
    }

    if (typeof coverUrl !== 'undefined') {
      data.coverUrl = coverUrl || null;
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
