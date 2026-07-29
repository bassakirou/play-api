import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardStats() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [
      songsCount,
      albumsCount,
      videosCount,
      artistsCount,
      usersCount,
      recentSongsCount,
      previousSongsCount,
      recentAlbumsCount,
      previousAlbumsCount,
      recentVideosCount,
      previousVideosCount,
      recentArtistsCount,
      previousArtistsCount,
      recentSongs,
      recentVideos,
    ] = await Promise.all([
      this.prisma.song.count(),
      this.prisma.album.count(),
      this.prisma.video.count(),
      this.prisma.artist.count(),
      this.prisma.user.count(),

      // Songs period comparison
      this.prisma.song.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.song.count({
        where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      }),

      // Albums period comparison
      this.prisma.album.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.album.count({
        where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      }),

      // Videos period comparison
      this.prisma.video.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.video.count({
        where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      }),

      // Artists period comparison
      this.prisma.artist.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.artist.count({
        where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      }),

      // Recent content
      this.prisma.song.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          artists: { select: { id: true, name: true } },
          groups: { select: { id: true, name: true } },
          genre: { select: { id: true, name: true } },
        },
      }),
      this.prisma.video.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          artists: { select: { id: true, name: true } },
          genre: { select: { id: true, name: true } },
        },
      }),
    ]);

    const calculateGrowth = (current: number, previous: number) => {
      if (previous === 0) {
        return current > 0 ? '+100%' : '+0%';
      }
      const pct = Math.round(((current - previous) / previous) * 1000) / 10;
      return pct >= 0 ? `+${pct}%` : `${pct}%`;
    };

    // Calculate 7-day chart data
    const days7: { label: string; v1: number; v2: number }[] = [];
    const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const startOfDay = new Date(d.setHours(0, 0, 0, 0));
      const endOfDay = new Date(d.setHours(23, 59, 59, 999));

      const [songsDay, videosDay] = await Promise.all([
        this.prisma.song.count({
          where: { createdAt: { gte: startOfDay, lte: endOfDay } },
        }),
        this.prisma.video.count({
          where: { createdAt: { gte: startOfDay, lte: endOfDay } },
        }),
      ]);

      days7.push({
        label: dayNames[startOfDay.getDay()],
        v1: songsDay,
        v2: videosDay,
      });
    }

    // Calculate 30-day (4 weeks) chart data
    const weeks30d: { label: string; v1: number; v2: number }[] = [];
    for (let i = 3; i >= 0; i--) {
      const startOfWeek = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
      const endOfWeek = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);

      const [songsW, videosW] = await Promise.all([
        this.prisma.song.count({
          where: { createdAt: { gte: startOfWeek, lte: endOfWeek } },
        }),
        this.prisma.video.count({
          where: { createdAt: { gte: startOfWeek, lte: endOfWeek } },
        }),
      ]);

      weeks30d.push({
        label: `Sem ${4 - i}`,
        v1: songsW,
        v2: videosW,
      });
    }

    // Calculate 3-month (4 months) chart data
    const months3m: { label: string; v1: number; v2: number }[] = [];
    const monthNames = [
      'Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin',
      'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'
    ];
    for (let i = 3; i >= 0; i--) {
      const mDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const startOfMonth = new Date(mDate.getFullYear(), mDate.getMonth(), 1);
      const endOfMonth = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 0, 23, 59, 59, 999);

      const [songsM, videosM] = await Promise.all([
        this.prisma.song.count({
          where: { createdAt: { gte: startOfMonth, lte: endOfMonth } },
        }),
        this.prisma.video.count({
          where: { createdAt: { gte: startOfMonth, lte: endOfMonth } },
        }),
      ]);

      months3m.push({
        label: monthNames[startOfMonth.getMonth()],
        v1: songsM,
        v2: videosM,
      });
    }

    return {
      songsCount,
      albumsCount,
      videosCount,
      artistsCount,
      usersCount,
      trends: {
        songs: calculateGrowth(recentSongsCount, previousSongsCount),
        albums: calculateGrowth(recentAlbumsCount, previousAlbumsCount),
        videos: calculateGrowth(recentVideosCount, previousVideosCount),
        artists: calculateGrowth(recentArtistsCount, previousArtistsCount),
      },
      recentSongs,
      recentVideos,
      chartData: {
        '7d': days7,
        '30d': weeks30d,
        '3m': months3m,
      },
    };
  }
}
