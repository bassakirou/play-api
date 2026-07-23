import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../storage/minio.service';
import { randomBytes } from 'crypto';

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

  async exportData() {
    this.logger.log('Starting data export...');

    const roles = await this.prisma.role.findMany({ include: { permissions: true } });
    const permissions = await this.prisma.permission.findMany();
    const users = await this.prisma.user.findMany({
      include: {
        favorites: { select: { id: true } },
        followingArtists: { select: { id: true } },
      },
    });
    const genres = await this.prisma.genre.findMany();
    const artistGroups = await this.prisma.artistGroup.findMany();
    const artists = await this.prisma.artist.findMany({
      include: {
        groups: { select: { id: true } },
      },
    });
    const albums = await this.prisma.album.findMany();
    const songs = await this.prisma.song.findMany({
      include: {
        artists: { select: { id: true } },
        groups: { select: { id: true } },
      },
    });
    const playlists = await this.prisma.playlist.findMany({
      include: {
        songs: { select: { id: true } },
      },
    });
    const videos = await (this.prisma as any).video.findMany({
      include: {
        artists: { select: { id: true } },
      },
    });
    const videoPlaylists = await (this.prisma as any).videoPlaylist.findMany({
      include: {
        Video: { select: { id: true } },
      },
    });
    const maintenanceSubscribers = await this.prisma.maintenanceSubscription.findMany();

    return {
      roles,
      permissions,
      users,
      genres,
      artistGroups,
      artists,
      albums,
      songs,
      playlists,
      videos,
      videoPlaylists,
      maintenanceSubscribers,
    };
  }

  private async migrateUrl(url: string | null | undefined, bucket: 'images' | 'audio' | 'videos', fileExtension = ''): Promise<string | null> {
    if (!url) return null;
    
    if (!url.includes('vercel-storage.com')) {
      return url;
    }

    this.logger.log(`Downloading media from Vercel: ${url}`);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn(`Failed to fetch ${url} (status ${response.status}). Keeping original URL.`);
        return url;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      
      let ext = fileExtension;
      if (!ext) {
         if (contentType.includes('image/jpeg')) ext = '.jpg';
         else if (contentType.includes('image/png')) ext = '.png';
         else if (contentType.includes('image/webp')) ext = '.webp';
         else if (contentType.includes('audio/mpeg')) ext = '.mp3';
         else if (contentType.includes('audio/wav')) ext = '.wav';
         else if (contentType.includes('video/mp4')) ext = '.mp4';
         else {
           const match = url.match(/\.([a-z0-9]+)(?:[\?#]|$)/i);
           if (match) ext = `.${match[1]}`;
         }
      }

      const uniqueName = `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`;

      if (this.minio.isEnabled()) {
        const result = await this.minio.upload({
          bucket,
          objectName: uniqueName,
          buffer,
          contentType,
        });
        
        const newUrl = typeof result === 'string' ? result : (result as any).url || result;
        this.logger.log(`Uploaded to MinIO: ${newUrl}`);
        return newUrl;
      } else {
        const fs = require('fs');
        const path = require('path');
        const dest = path.join(process.cwd(), 'uploads', bucket);
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, uniqueName), buffer);
        const newUrl = `/uploads/${bucket}/${uniqueName}`;
        this.logger.log(`Saved locally: ${newUrl}`);
        return newUrl;
      }
    } catch (e) {
      this.logger.error(`Error migrating url ${url}: ${e.message}`);
      return url; 
    }
  }

  async importData(data: any) {
    this.logger.log('Starting data import...');

    if (data.permissions) {
      for (const p of data.permissions) {
        try {
          const existing = await this.prisma.permission.findFirst({
            where: { action: p.action, resource: p.resource },
          });
          const targetId = existing ? existing.id : p.id;
          await this.prisma.permission.upsert({
            where: { id: targetId },
            update: { action: p.action, resource: p.resource },
            create: { id: targetId, action: p.action, resource: p.resource },
          });
        } catch (e) {
          this.logger.warn(`Permission import warning: ${e.message}`);
        }
      }
    }

    if (data.roles) {
      for (const r of data.roles) {
        const perms = r.permissions || [];
        await this.prisma.role.upsert({
          where: { id: r.id },
          update: {
            name: r.name,
            permissions: { set: perms.map((p: any) => ({ id: p.id })) },
          },
          create: {
            id: r.id,
            name: r.name,
            permissions: { connect: perms.map((p: any) => ({ id: p.id })) },
          },
        });
      }
    }

    if (data.users) {
      for (const u of data.users) {
        const { favorites, followingArtists, artistProfile, ...userData } = u;
        await this.prisma.user.upsert({
          where: { id: u.id },
          update: { ...userData },
          create: { ...userData },
        });
      }
    }

    if (data.genres) {
      for (const g of data.genres) {
        await this.prisma.genre.upsert({
          where: { id: g.id },
          update: { ...g },
          create: { ...g },
        });
      }
    }

    if (data.artistGroups) {
      for (const ag of data.artistGroups) {
        await this.prisma.artistGroup.upsert({
          where: { id: ag.id },
          update: { ...ag },
          create: { ...ag },
        });
      }
    }

    if (data.artists) {
      for (const a of data.artists) {
        const { groups, ...artistData } = a;
        
        artistData.imageUrl = await this.migrateUrl(artistData.imageUrl, 'images');
        artistData.bannerUrl = await this.migrateUrl(artistData.bannerUrl, 'images');
        if (artistData.gallery) {
           try {
              const galleryUrls = JSON.parse(artistData.gallery);
              if (Array.isArray(galleryUrls)) {
                 const newUrls: string[] = [];
                 for(const url of galleryUrls) {
                    const migrated = await this.migrateUrl(url, 'images');
                    if (migrated) newUrls.push(migrated);
                 }
                 artistData.gallery = JSON.stringify(newUrls);
              }
           } catch(e) {}
        }

        await this.prisma.artist.upsert({
          where: { id: a.id },
          update: {
            ...artistData,
            groups: { set: (groups || []).map((g: any) => ({ id: g.id })) },
          },
          create: {
            ...artistData,
            groups: { connect: (groups || []).map((g: any) => ({ id: g.id })) },
          },
        });
      }
    }

    if (data.albums) {
      for (const a of data.albums) {
        a.coverUrl = await this.migrateUrl(a.coverUrl, 'images');
        await this.prisma.album.upsert({
          where: { id: a.id },
          update: { ...a },
          create: { ...a },
        });
      }
    }

    if (data.songs) {
      for (const s of data.songs) {
        const { artists, groups, playlists, favoritedBy, ...songData } = s;
        songData.coverUrl = await this.migrateUrl(songData.coverUrl, 'images');
        songData.audioUrl = await this.migrateUrl(songData.audioUrl, 'audio');
        
        await this.prisma.song.upsert({
          where: { id: s.id },
          update: {
            ...songData,
            artists: { set: (artists || []).map((a: any) => ({ id: a.id })) },
            groups: { set: (groups || []).map((g: any) => ({ id: g.id })) },
          },
          create: {
            ...songData,
            artists: { connect: (artists || []).map((a: any) => ({ id: a.id })) },
            groups: { connect: (groups || []).map((g: any) => ({ id: g.id })) },
          },
        });
      }
    }

    if (data.playlists) {
      for (const p of data.playlists) {
        const { songs, ...playlistData } = p;
        playlistData.coverUrl = await this.migrateUrl(playlistData.coverUrl, 'images');
        
        await this.prisma.playlist.upsert({
          where: { id: p.id },
          update: {
            ...playlistData,
            songs: { set: (songs || []).map((s: any) => ({ id: s.id })) },
          },
          create: {
            ...playlistData,
            songs: { connect: (songs || []).map((s: any) => ({ id: s.id })) },
          },
        });
      }
    }

    if (data.videos) {
      for (const v of data.videos) {
        const { artists, VideoPlaylist, genre, ...videoData } = v;
        videoData.thumbnailUrl = await this.migrateUrl(videoData.thumbnailUrl, 'images');
        videoData.videoUrl = await this.migrateUrl(videoData.videoUrl, 'videos');
        
        await (this.prisma as any).video.upsert({
          where: { id: v.id },
          update: {
            ...videoData,
            artists: { set: (artists || []).map((a: any) => ({ id: a.id })) },
          },
          create: {
            ...videoData,
            artists: { connect: (artists || []).map((a: any) => ({ id: a.id })) },
          },
        });
      }
    }

    if (data.videoPlaylists) {
      for (const vp of data.videoPlaylists) {
        const { Video, User, ...vpData } = vp;
        await (this.prisma as any).videoPlaylist.upsert({
          where: { id: vp.id },
          update: {
            ...vpData,
            Video: { set: (Video || []).map((v: any) => ({ id: v.id })) },
          },
          create: {
            ...vpData,
            Video: { connect: (Video || []).map((v: any) => ({ id: v.id })) },
          },
        });
      }
    }
    
    if (data.maintenanceSubscribers) {
       for (const m of data.maintenanceSubscribers) {
         await this.prisma.maintenanceSubscription.upsert({
            where: { id: m.id },
            update: { ...m },
            create: { ...m },
         });
       }
    }

    if (data.users) {
      for (const u of data.users) {
        const favorites = u.favorites || [];
        const followingArtists = u.followingArtists || [];
        
        if (favorites.length > 0 || followingArtists.length > 0) {
           try {
             await this.prisma.user.update({
               where: { id: u.id },
               data: {
                  favorites: { connect: favorites.map((f:any) => ({ id: f.id })) },
                  followingArtists: { connect: followingArtists.map((a:any) => ({ id: a.id })) }
               }
             });
           } catch(e) {
             this.logger.error(`Error updating user relations for ${u.id}: ${e.message}`);
           }
        }
      }
    }

    this.logger.log('Import completed successfully!');
    return { success: true };
  }
}
