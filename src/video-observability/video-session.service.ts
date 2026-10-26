import {
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  DeliveryCaller,
  VideoDeliveryService,
} from '../video-delivery/video-delivery.service';
import { VideoPulseDto } from './video-session.dto';

@Injectable()
export class VideoSessionService {
  private readonly starts = new Map<string, { count: number; until: number }>();
  private readonly salt = randomBytes(16).toString('hex');
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: VideoDeliveryService,
  ) {}

  async start(videoId: string, caller?: DeliveryCaller, ip = '') {
    const key = createHash('sha256')
      .update(this.salt + ip)
      .digest('hex');
    const now = Date.now();
    const rate = this.starts.get(key);
    if (rate && rate.until > now && rate.count >= 20)
      throw new HttpException('Trop de démarrages de lecture', 429);
    // Bound anonymous rate-limit memory without discarding live counters.
    if (this.starts.size > 10000)
      for (const [k, value] of this.starts)
        if (value.until <= now) this.starts.delete(k);
    if (this.starts.size > 20000 && !rate)
      throw new HttpException('Télémétrie temporairement occupée', 429);
    this.starts.set(key, {
      count: rate && rate.until > now ? rate.count + 1 : 1,
      until: rate && rate.until > now ? rate.until : now + 60_000,
    });
    await this.access.accessibleVideo(videoId, caller);
    const token = randomBytes(32).toString('hex');
    const session = await this.prisma.videoPlaybackSession.create({
      data: {
        videoId,
        tokenHash: this.hash(token),
        startedAt: new Date(now),
        lastSeenAt: new Date(now),
        expiresAt: new Date(now),
        playing: false,
      },
    });
    return { id: session.id, token };
  }

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  async pulse(id: string, dto: VideoPulseDto) {
    const session = await this.prisma.videoPlaybackSession.findUnique({
      where: { id },
    });
    if (!session) throw new NotFoundException('Session expirée');
    const hash = this.hash(dto.token);
    if (
      !timingSafeEqual(
        Buffer.from(hash, 'hex'),
        Buffer.from(session.tokenHash, 'hex'),
      )
    )
      throw new UnauthorizedException('Session invalide');
    if (session.endedAt || dto.sequence <= session.sequence)
      return { accepted: false };
    const now = new Date();
    const elapsed = Math.max(
      0,
      (now.getTime() - session.lastSeenAt.getTime()) / 1000,
    );
    const age = Math.max(
      0,
      (now.getTime() - session.startedAt.getTime()) / 1000,
    );
    const playedDelta = Math.max(
      0,
      Math.min(
        dto.cumulativePlayedSeconds - session.reportedSeconds,
        elapsed + 2,
      ),
    );
    const total = Math.min(age + 2, session.playedSeconds + playedDelta);
    const result = await this.prisma.videoPlaybackSession.updateMany({
      where: { id, sequence: session.sequence, endedAt: null },
      data: {
        sequence: dto.sequence,
        lastSeenAt: now,
        playing: dto.playing && !dto.ended,
        expiresAt:
          dto.ended || !dto.playing ? now : new Date(now.getTime() + 75_000),
        endedAt: dto.ended ? now : null,
        playedSeconds: total,
        reportedSeconds: Math.max(
          session.reportedSeconds,
          dto.cumulativePlayedSeconds,
        ),
        bufferSeconds: Math.min(
          age,
          Math.max(session.bufferSeconds, dto.bufferSeconds),
        ),
        stalls: Math.max(session.stalls, dto.stalls),
        errors: Math.max(session.errors, dto.errors),
        startupMs: session.startupMs ?? dto.startupMs ?? null,
        height: dto.height || session.height,
      },
    });
    return { accepted: result.count > 0 };
  }

  async summary(from: Date) {
    const where = { startedAt: { gte: from } };
    const [activeSessions, sums, errorSessions, top, quality] =
      await Promise.all([
        this.prisma.videoPlaybackSession.count({
          where: {
            playing: true,
            expiresAt: { gt: new Date() },
            endedAt: null,
          },
        }),
        this.prisma.videoPlaybackSession.aggregate({
          where,
          _count: { _all: true },
          _sum: {
            playedSeconds: true,
            bufferSeconds: true,
            stalls: true,
            errors: true,
          },
          _avg: { startupMs: true },
        }),
        this.prisma.videoPlaybackSession.count({
          where: { ...where, errors: { gt: 0 } },
        }),
        this.prisma.videoPlaybackSession.groupBy({
          by: ['videoId'],
          where,
          _count: { _all: true },
          _sum: { playedSeconds: true },
          orderBy: { _sum: { playedSeconds: 'desc' } },
          take: 10,
        }),
        this.prisma.videoPlaybackSession.groupBy({
          by: ['height'],
          where,
          _count: { _all: true },
        }),
      ]);
    const videos = await this.prisma.video.findMany({
      where: { id: { in: top.map((row) => row.videoId) } },
      select: { id: true, title: true },
    });
    const titles = new Map(videos.map((video) => [video.id, video.title]));
    return {
      activeSessions,
      starts: sums._count._all,
      playedSeconds: sums._sum.playedSeconds || 0,
      bufferSeconds: sums._sum.bufferSeconds || 0,
      stalls: sums._sum.stalls || 0,
      errors: sums._sum.errors || 0,
      errorSessions,
      startupMsAvg: sums._avg.startupMs,
      topVideos: top.map((row) => ({
        videoId: row.videoId,
        title: titles.get(row.videoId) || 'Vidéo supprimée',
        sessions: row._count._all,
        playedSeconds: row._sum.playedSeconds || 0,
      })),
      quality: quality.map((row) => ({
        height: row.height,
        sessions: row._count._all,
      })),
    };
  }
}
