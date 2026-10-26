import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { HostMetricsService } from './host-metrics.service';
import { VideoSessionService } from './video-session.service';
import { CloudflareUsageService } from './cloudflare-usage.service';

@Injectable()
export class VideoMonitorService implements OnModuleInit {
  private readonly logger = new Logger(VideoMonitorService.name);
  private running = false;
  private lastCleanup = 0;
  private cpuHot = 0;
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly host: HostMetricsService,
    private readonly sessions: VideoSessionService,
    private readonly cloudflare: CloudflareUsageService,
  ) {}

  onModuleInit() {
    void this.sample();
  }

  private async health(check: () => Promise<unknown>) {
    const start = Date.now();
    try {
      await check();
      return { ok: true, ms: Date.now() - start };
    } catch {
      return { ok: false, ms: Date.now() - start };
    }
  }

  @Interval(15_000)
  async sample() {
    if (this.running || this.config.get('MONITORING_ENABLED') === 'false')
      return;
    this.running = true;
    try {
      const [metrics, database, minio, activeSessions] = await Promise.all([
        this.host.collect(),
        this.health(() =>
          this.prisma.$transaction(
            async (tx) => {
              await tx.$executeRaw`SET LOCAL statement_timeout = '2500ms'`;
              return tx.$queryRaw`SELECT 1`;
            },
            { maxWait: 3000, timeout: 3500 },
          ),
        ),
        this.minioHealth(),
        this.prisma.videoPlaybackSession.count({
          where: {
            playing: true,
            expiresAt: { gt: new Date() },
            endedAt: null,
          },
        }),
      ]);
      await this.prisma.videoMonitorSample.create({
        data: {
          ...metrics,
          disks: metrics.disks as any,
          activeSessions,
          databaseOk: database.ok,
          databaseMs: database.ms,
          minioOk: minio.ok,
          minioMs: minio.ms,
        },
      });
      await this.evaluate(metrics, database.ok, minio.ok, activeSessions);
    } catch {
      this.logger.warn(
        'Relevé de surveillance indisponible ; les dernières mesures restent datées.',
      );
    } finally {
      this.running = false;
    }
  }

  @Interval(3_600_000)
  async cleanup() {
    try {
      if (Date.now() - this.lastCleanup > 3_600_000) {
        const days = Math.min(
          30,
          Math.max(1, Number(this.config.get('MONITOR_RETENTION_DAYS')) || 7),
        );
        const before = new Date(Date.now() - days * 86_400_000);
        await this.prisma.$transaction([
          this.prisma.videoMonitorSample.deleteMany({
            where: { sampledAt: { lt: before } },
          }),
          this.prisma.videoPlaybackSession.deleteMany({
            where: { lastSeenAt: { lt: before } },
          }),
          this.prisma.videoExternalProbe.deleteMany({
            where: { observedAt: { lt: before } },
          }),
          this.prisma.videoMonitorAlert.deleteMany({
            where: { resolvedAt: { lt: before } },
          }),
        ]);
        this.lastCleanup = Date.now();
      }
    } catch {
      this.logger.warn('Rétention de télémétrie temporairement indisponible.');
    }
  }

  private async minioHealth(): Promise<{
    ok: boolean | null;
    ms: number | null;
  }> {
    const endpoint = this.config.get<string>('MINIO_ENDPOINT');
    if (!endpoint) return { ok: null, ms: null };
    const tls = this.config.get('MINIO_USE_SSL') === 'true';
    const port = this.config.get('MINIO_PORT') || (tls ? '443' : '9000');
    let url: URL;
    try {
      url = new URL(
        endpoint.includes('://')
          ? endpoint
          : `${tls ? 'https' : 'http'}://${endpoint}:${port}`,
      );
    } catch {
      return { ok: null, ms: null };
    }
    url.pathname = '/minio/health/live';
    url.search = '';
    url.username = '';
    url.password = '';
    return this.health(async () => {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(3000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('MinIO unavailable');
      await response.body?.cancel();
    });
  }

  async setAlert(
    key: string,
    condition: boolean | null,
    severity: string,
    message: string,
  ) {
    if (condition === null) return;
    const current = await this.prisma.videoMonitorAlert.findUnique({
      where: { key },
    });
    const now = new Date();
    if (!condition) {
      if (current && !current.resolvedAt)
        await this.prisma.videoMonitorAlert.update({
          where: { key },
          data: { resolvedAt: now },
        });
      return;
    }
    await this.prisma.videoMonitorAlert.upsert({
      where: { key },
      create: { key, severity, message, openedAt: now, lastSeenAt: now },
      update: {
        severity,
        message,
        lastSeenAt: now,
        ...(current?.resolvedAt
          ? {
              openedAt: now,
              resolvedAt: null,
              acknowledgedAt: null,
              occurrences: { increment: 1 },
            }
          : {}),
      },
    });
  }

  private async evaluate(
    metrics: Awaited<ReturnType<HostMetricsService['collect']>>,
    database: boolean,
    minio: boolean | null,
    active: number,
  ) {
    const prefix = `host:${metrics.hostId}:`;
    this.cpuHot =
      metrics.cpuPercent != null && metrics.cpuPercent >= 85
        ? this.cpuHot + 1
        : 0;
    const previous = await this.prisma.videoMonitorSample.aggregate({
      where: {
        hostId: metrics.hostId,
        sampledAt: {
          gte: new Date(Date.now() - 600_000),
          lt: new Date(Date.now() - 60_000),
        },
      },
      _avg: { activeSessions: true },
    });
    const baseline = previous._avg.activeSessions;
    const spikeMinimum = Math.max(
      20,
      Number(this.config.get('MONITOR_VIEWER_SPIKE_COUNT')) || 100,
    );
    const quality = await this.sessions.summary(new Date(Date.now() - 300_000));
    const cost = await this.cloudflare.overview();
    const budgetSpend = cost.totalUsd;
    await Promise.all([
      this.setAlert(
        prefix + 'cpu',
        metrics.cpuPercent === null ? null : this.cpuHot >= 3,
        'warning',
        'CPU supérieur à 85 % pendant au moins trois relevés.',
      ),
      this.setAlert(
        prefix + 'memory',
        metrics.memoryPercent === null ? null : metrics.memoryPercent >= 90,
        'warning',
        'Mémoire utilisée à au moins 90 %.',
      ),
      this.setAlert(
        prefix + 'disk',
        metrics.diskPercent === null ? null : metrics.diskPercent >= 85,
        metrics.diskPercent != null && metrics.diskPercent >= 95
          ? 'critical'
          : 'warning',
        'Un volume surveillé est rempli à au moins 85 %.',
      ),
      this.setAlert(
        prefix + 'network',
        metrics.networkCapacityMbps && metrics.networkTxBps != null
          ? (metrics.networkTxBps * 8) / 1e6 >=
              metrics.networkCapacityMbps * 0.85
          : null,
        'warning',
        'Débit sortant supérieur à 85 % de la capacité renseignée.',
      ),
      this.setAlert(
        prefix + 'database',
        !database,
        'critical',
        'La sonde PostgreSQL échoue.',
      ),
      this.setAlert(
        prefix + 'minio',
        minio === null ? null : !minio,
        'critical',
        'La sonde MinIO échoue.',
      ),
      this.setAlert(
        'audience:spike',
        baseline === null
          ? null
          : active >= spikeMinimum && active >= Math.max(1, baseline) * 3,
        'warning',
        'Pic de lectures simultanées : au moins trois fois le niveau récent.',
      ),
      this.setAlert(
        'audience:errors',
        quality.starts < 20
          ? null
          : quality.errorSessions / quality.starts >= 0.05,
        'warning',
        'Au moins 5 % des sessions démarrées ces cinq dernières minutes signalent une erreur.',
      ),
      this.setAlert(
        'cloudflare:budget',
        cost.state !== 'ready' ||
          budgetSpend === null ||
          cost.budgetUsd === null
          ? null
          : budgetSpend >= cost.budgetUsd * 0.8,
        budgetSpend !== null &&
          cost.budgetUsd !== null &&
          budgetSpend >= cost.budgetUsd
          ? 'critical'
          : 'warning',
        'Coût Cloudflare estimé supérieur à 80 % du budget mensuel.',
      ),
    ]);
  }

  async acknowledge(id: string) {
    const result = await this.prisma.videoMonitorAlert.updateMany({
      where: { id, resolvedAt: null },
      data: { acknowledgedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Alerte active introuvable');
    return { acknowledged: true };
  }

  async overview(range: string, requestedHost?: string) {
    const hours = range === '7d' ? 168 : range === '24h' ? 24 : 1;
    const from = new Date(Date.now() - hours * 3_600_000);
    const hosts = await this.prisma.$queryRaw<
      { id: string; lastSeenAt: Date }[]
    >`SELECT "hostId" AS id, MAX("sampledAt") AS "lastSeenAt" FROM "VideoMonitorSample" WHERE "sampledAt" >= ${new Date(Date.now() - 7 * 86_400_000)} GROUP BY "hostId" ORDER BY MAX("sampledAt") DESC LIMIT 50`;
    const hostId = hosts.some((host) => host.id === requestedHost)
      ? requestedHost!
      : (hosts[0]?.id ?? this.host.hostId);
    const bucket =
      hours === 1 ? '1 minute' : hours === 24 ? '15 minutes' : '1 hour';
    const [
      latest,
      history,
      audience,
      alerts,
      cloudflare,
      probes,
      probeFailures,
    ] = await Promise.all([
      this.prisma.videoMonitorSample.findFirst({
        where: { hostId },
        orderBy: { sampledAt: 'desc' },
      }),
      this.prisma
        .$queryRaw`SELECT date_bin(${bucket}::interval, "sampledAt", TIMESTAMP '2000-01-01') AS at, MAX("cpuPercent") AS "cpuPercent", MAX("memoryPercent") AS "memoryPercent", MAX("diskPercent") AS "diskPercent", AVG("networkTxBps") AS "networkTxBps", MAX("activeSessions") AS "activeSessions" FROM "VideoMonitorSample" WHERE "hostId" = ${hostId} AND "sampledAt" >= ${from} GROUP BY at ORDER BY at`,
      this.sessions.summary(from),
      this.prisma.videoMonitorAlert.findMany({
        where: { OR: [{ resolvedAt: null }, { lastSeenAt: { gte: from } }] },
        orderBy: { lastSeenAt: 'desc' },
        take: 100,
      }),
      this.cloudflare.overview(),
      this.prisma
        .$queryRaw`SELECT DISTINCT ON ("probeId") "probeId", "observedAt", status, "latencyMs" FROM "VideoExternalProbe" WHERE "observedAt" >= ${from} ORDER BY "probeId", "observedAt" DESC LIMIT 50`,
      this.prisma.videoExternalProbe.findMany({
        where: { observedAt: { gte: from }, status: 'down' },
        orderBy: { observedAt: 'desc' },
        take: 100,
      }),
    ]);
    return {
      hosts,
      hostId,
      latest,
      history,
      audience,
      alerts,
      cloudflare,
      probes,
      probeFailures,
    };
  }
}
