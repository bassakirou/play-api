import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../storage/minio.service';
import { ContentAccessService } from '../content-access/content-access.service';
import { isMediaStorageUrl } from '../content-access/media-storage-url';
import { hostname } from 'node:os';
import {
  CloudflareStreamService,
  StreamVideo,
} from './cloudflare-stream.service';

export type DeliveryCaller = { id?: string; role?: string };
const isAdmin = (caller?: DeliveryCaller) =>
  ['ADMIN', 'SUPER_ADMIN'].includes(caller?.role || '');

@Injectable()
export class VideoDeliveryService {
  private readonly logger = new Logger(VideoDeliveryService.name);
  private running = false;
  private failures = 0;
  private circuitUntil = 0;

  async routing() {
    const policy = await this.prisma.videoRoutingPolicy.findUnique({ where: { id: 'default' } });
    return { mode: policy?.mode || 'CLOUDFLARE_FIRST', circuitUntil: this.circuitUntil > Date.now() ? this.circuitUntil : null };
  }

  async setRouting(mode: string) {
    if (!['CLOUDFLARE_FIRST', 'LOCAL_ONLY'].includes(mode)) throw new BadRequestException('Mode invalide');
    return this.prisma.videoRoutingPolicy.upsert({ where: { id: 'default' }, create: { id: 'default', mode }, update: { mode } });
  }

  async migrationCandidates() {
    return this.prisma.video.findMany({ where: { OR: [{ mediaAssetId: null }, { mediaAsset: { delivery: null } }] }, select: { id: true, title: true, duration: true }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async migrate(videoId: string) {
    if (!this.cloudflare.isEnabled()) throw new ServiceUnavailableException('Cloudflare non configuré');
    const video = await this.prisma.video.findUnique({ where: { id: videoId }, include: { mediaAsset: true } });
    if (!video) throw new NotFoundException('Vidéo introuvable');
    let asset = video.mediaAsset;
    if (!asset) {
      if (!isMediaStorageUrl(video.videoUrl)) throw new BadRequestException('Original local requis. Réimportez le fichier sur cette vidéo.');
      const url = new URL(video.videoUrl, 'http://local.invalid');
      const parts = decodeURIComponent(url.pathname).replace(/^\//, '').split('/');
      const bucket = parts.shift()!;
      const object = parts.join('/');
      if (bucket !== this.minio.getBucketName('videos') || !/\.(mp4|mov|webm|mkv)$/i.test(object) || !(await this.minio.objectExists(bucket, object)))
        throw new BadRequestException('Original vidéo introuvable. Réimportez le fichier original sur la vidéo existante ; un manifeste HLS seul ne suffit pas.');
      // Serialize repeated clicks so one video cannot create multiple local assets.
      return this.prisma.$transaction(async db => {
        await db.$queryRaw`SELECT id FROM "Video" WHERE id = ${videoId} FOR UPDATE`;
        const current = await db.video.findUnique({ where: { id: videoId } });
        const media = current?.mediaAssetId ? await db.mediaAsset.findUnique({ where: { id: current.mediaAssetId } }) : await db.mediaAsset.create({ data: { title: video.title, filename: object.split('/').pop()!, fileUrl: video.videoUrl, type: 'video', userId: video.userId, originalBucket: bucket, originalObject: object } });
        if (!media) throw new BadRequestException('Original introuvable');
        await db.videoDelivery.upsert({ where: { mediaAssetId: media.id }, create: { mediaAssetId: media.id }, update: {} });
        await db.video.update({ where: { id: videoId }, data: { mediaAssetId: media.id } });
        return { queued: true };
      });
    }
    if (asset.type !== 'video' || asset.originalBucket !== this.minio.getBucketName('videos') || !asset.originalObject || !(await this.minio.objectExists(asset.originalBucket, asset.originalObject))) throw new BadRequestException('Original MinIO introuvable ; réimportez-le avant de migrer.');
    await this.prisma.videoDelivery.upsert({ where: { mediaAssetId: asset.id }, create: { mediaAssetId: asset.id }, update: {} });
    return { queued: true };
  }

  private async localPlayback(video: any, caller?: DeliveryCaller) {
    if (!this.contentAccess) throw new ServiceUnavailableException('Secours local indisponible');
    const sample = this.prisma.videoMonitorSample && await this.prisma.videoMonitorSample.findFirst({ where: { hostId: process.env.MONITOR_HOST_ID || hostname(), sampledAt: { gte: new Date(Date.now() - 45_000) } }, orderBy: { sampledAt: 'desc' } });
    if (sample && ((sample.cpuPercent ?? 0) >= 95 || (sample.memoryPercent ?? 0) >= 95 || sample.minioOk === false || (sample.networkCapacityMbps && (sample.networkTxBps ?? 0) * 8 / 1e6 >= sample.networkCapacityMbps * 0.9)))
      throw new ServiceUnavailableException('Le serveur de secours est momentanément saturé. Réessayez plus tard.');
    const asset = video.mediaAsset;
    if (asset?.originalBucket && asset?.originalObject && !(await this.minio.objectExists(asset.originalBucket, asset.originalObject))) throw new ServiceUnavailableException('Original local indisponible');
    return { ...(await this.contentAccess.playback('VIDEO', video.id, caller)), provider: 'MINIO' };
  }
  private readonly tokens = new Map<
    string,
    { url: string; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly cloudflare: CloudflareStreamService,
    @Optional() private readonly contentAccess?: ContentAccessService,
  ) {}

  async sourceReference(
    videoId: string,
    mediaAssetId: string | undefined | null,
    fallback: string,
  ) {
    if (!mediaAssetId) return fallback;
    const job = await this.prisma.videoDelivery.findUnique({
      where: { mediaAssetId },
      select: { id: true },
    });
    return job ? `pyramidplay:video:${videoId}` : fallback;
  }

  async original(mediaAssetId: string) {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: mediaAssetId },
    });
    if (
      !asset ||
      asset.type !== 'video' ||
      !asset.originalObject ||
      asset.originalBucket !== this.minio.getBucketName('videos')
    ) {
      throw new NotFoundException('Original indisponible');
    }
    const result = await this.minio.readVideoOriginal(
      asset.originalBucket,
      asset.originalObject,
    );
    return {
      stream: result.stream,
      size: result.stat?.size ?? asset.size,
      mimeType: asset.mimeType || 'video/mp4',
    };
  }

  async preparePublication(
    mediaAssetId: string | undefined | null,
    requested: boolean,
    caller: DeliveryCaller,
  ) {
    if (!mediaAssetId)
      return {
        mediaAssetId: null,
        isPublished: requested,
        publishWhenReady: false,
      };
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: mediaAssetId },
    });
    if (!asset || asset.type !== 'video')
      throw new BadRequestException('Média vidéo source introuvable');
    if (!isAdmin(caller) && (!caller.id || asset.userId !== caller.id)) {
      const ownedVideo =
        caller.id &&
        (await this.prisma.video.findFirst({
          where: { mediaAssetId, userId: caller.id },
          select: { id: true },
        }));
      if (!ownedVideo)
        throw new ForbiddenException('Ce média ne vous appartient pas');
    }
    const existing = await this.prisma.videoDelivery.findUnique({
      where: { mediaAssetId },
    });
    if (!existing && !this.cloudflare.isEnabled())
      return { mediaAssetId, isPublished: requested, publishWhenReady: false };
    if (!asset.originalBucket || !asset.originalObject)
      throw new BadRequestException(
        'Réimportez le fichier original dans MinIO avant la diffusion Cloudflare',
      );
    const job =
      existing ||
      (await this.prisma.videoDelivery.upsert({
        where: { mediaAssetId },
        update: {},
        create: { mediaAssetId, status: 'QUEUED' },
      }));
    const ready = job.status === 'READY';
    return {
      mediaAssetId,
      isPublished: requested && ready,
      publishWhenReady: requested && !ready,
    };
  }

  async accessibleVideo(videoId: string, caller?: DeliveryCaller) {
    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      include: { mediaAsset: { include: { delivery: true } } },
    });
    if (!video) throw new NotFoundException('Vidéo introuvable');
    const privileged =
      (this.contentAccess ? await this.contentAccess.isAdmin(caller) : isAdmin(caller)) || (!!caller?.id && caller.id === video.userId);
    if (!video.isPublished && !privileged)
      throw new NotFoundException('Vidéo indisponible');
    if (video.isMonetized && Number(video.price) > 0 && !privileged) {
      const purchase =
        caller?.id &&
        (await this.prisma.userPurchasedContent.findUnique({
          where: {
            userId_contentId_contentType: {
              userId: caller.id,
              contentId: videoId,
              contentType: 'VIDEO',
            },
          },
        }));
      if (!purchase)
        throw new ForbiddenException(
          'Achetez cette vidéo pour accéder à la lecture',
        );
    }
    return video;
  }

  async playback(videoId: string, caller?: DeliveryCaller, forceLocal = false) {
    const video = await this.accessibleVideo(videoId, caller);
    const delivery = video.mediaAsset?.delivery;
    const policy = this.prisma.videoRoutingPolicy ? await this.routing() : { mode: 'CLOUDFLARE_FIRST' };
    if (forceLocal || policy.mode === 'LOCAL_ONLY' || this.circuitUntil > Date.now()) return this.localPlayback(video, caller);
    if (!delivery) {
      if (this.contentAccess) return this.contentAccess.playback('VIDEO', videoId, caller);
      throw new ServiceUnavailableException('Vidéo indisponible');
    }
    if (delivery.status !== 'READY' || !delivery.remoteUid || !this.cloudflare.isEnabled()) return this.localPlayback(video, caller);
    const cached = this.tokens.get(delivery.remoteUid);
    if (cached && cached.expiresAt > Date.now() / 1000 + 300) return cached;
    let token: { url: string; expiresAt: number };
    try {
      token = await this.cloudflare.playback(delivery.remoteUid);
      this.failures = 0;
    } catch {
      if (++this.failures >= 3) this.circuitUntil = Date.now() + 60_000;
      this.logger.warn('Cloudflare indisponible : tentative de secours local');
      return this.localPlayback(video, caller);
    }
    // Bound cache size; authorization is checked on every request before this cache.
    if (this.tokens.size > 2000) this.tokens.clear();
    this.tokens.set(delivery.remoteUid, token);
    return token;
  }

  @Interval(10_000)
  async processNext() {
    if (this.running || !this.cloudflare.isEnabled()) return;
    this.running = true;
    try {
      // Repair publication intent after a crash or a READY/create race.
      await this.prisma.video.updateMany({
        where: {
          publishWhenReady: true,
          mediaAsset: { delivery: { status: 'READY' } },
        },
        data: { isPublished: true, publishWhenReady: false },
      });
      const now = new Date();
      const job = await this.prisma.videoDelivery.findFirst({
        where: {
          status: { in: ['QUEUED', 'PROCESSING', 'RETRY'] },
          nextAttemptAt: { lte: now },
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
        },
        include: { mediaAsset: true },
        orderBy: { nextAttemptAt: 'asc' },
      });
      if (!job) return;
      const leaseUntil = new Date(now.getTime() + 90_000);
      const lease = await this.prisma.videoDelivery.updateMany({
        where: {
          id: job.id,
          status: job.status,
          leaseUntil: job.leaseUntil,
          nextAttemptAt: job.nextAttemptAt,
        },
        data: { leaseUntil },
      });
      if (!lease.count) return;
      try {
        let remote: StreamVideo;
        if (job.remoteUid)
          remote = await this.cloudflare.inspect(job.remoteUid);
        else {
          // Recover an accepted copy after a connection failure before submitting a new one.
          const found = await this.cloudflare.findCopy(job.mediaAssetId);
          if (found) remote = found;
          else {
            const source = job.mediaAsset;
            if (
              !source.originalObject ||
              source.originalBucket !== this.minio.getBucketName('videos')
            )
              throw new Error('ORIGINAL_UNAVAILABLE');
            const url = this.cloudflare.sourceUrl(job.mediaAssetId);
            remote = await this.cloudflare.copy(url, job.mediaAssetId);
          }
        }
        const ready =
          remote.readyToStream === true &&
          remote.status?.state === 'ready' &&
          Number(remote.status?.pctComplete ?? 100) >= 100;
        if (
          !ready &&
          remote.status?.state !== 'error' &&
          job.status === 'PROCESSING' &&
          now.getTime() - (job.processingStartedAt || job.createdAt).getTime() >
            24 * 3600_000
        ) {
          await this.prisma.videoDelivery.updateMany({
            where: { id: job.id, leaseUntil },
            data: {
              status: 'ERROR',
              failureCode: 'PROCESSING_TIMEOUT',
              leaseUntil: null,
              lastError:
                'La préparation dépasse 24 heures. Vérifiez le traitement avant de relancer.',
            },
          });
        } else await this.reconcile(job.id, remote, leaseUntil);
      } catch {
        const attempts = job.attempts + 1;
        await this.prisma.videoDelivery.updateMany({
          where: { id: job.id, leaseUntil },
          data: {
            status: attempts >= 5 ? 'ERROR' : 'RETRY',
            attempts,
            leaseUntil: null,
            failureCode: 'UPSTREAM_UNAVAILABLE',
            lastError:
              'Transfert ou vérification impossible. Vérifiez la configuration et l’accessibilité de l’original.',
            nextAttemptAt: new Date(
              Date.now() + Math.min(3600, 30 * 2 ** attempts) * 1000,
            ),
          },
        });
      }
    } catch {
      this.logger.warn(
        'La file de diffusion vidéo est temporairement indisponible',
      );
    } finally {
      this.running = false;
    }
  }

  async reconcile(id: string, remote: StreamVideo, leaseUntil?: Date) {
    const job = await this.prisma.videoDelivery.findUnique({ where: { id } });
    if (!job || (job.remoteUid && job.remoteUid !== remote.uid)) return;
    if (job.status === 'READY') {
      await this.publishReady(job.mediaAssetId);
      return;
    }
    const failed = remote.status?.state === 'error';
    const ready =
      remote.readyToStream === true &&
      remote.status?.state === 'ready' &&
      Number(remote.status?.pctComplete ?? 100) >= 100;
    const result = await this.prisma.videoDelivery.updateMany({
      where: { id, status: job.status, ...(leaseUntil ? { leaseUntil } : {}) },
      data: {
        remoteUid: remote.uid,
        status: failed ? 'ERROR' : ready ? 'READY' : 'PROCESSING',
        lastError: failed
          ? 'L’encodage Cloudflare a échoué. L’original est conservé.'
          : null,
        failureCode: failed ? 'ENCODING_FAILED' : null,
        attempts: failed ? job.attempts : 0,
        processingStartedAt: job.processingStartedAt || new Date(),
        leaseUntil: null,
        syncedAt: new Date(),
        nextAttemptAt: new Date(Date.now() + 30_000),
      },
    });
    if (result.count && ready) await this.publishReady(job.mediaAssetId);
  }

  private publishReady(mediaAssetId: string) {
    return this.prisma.video.updateMany({
      where: { mediaAssetId, publishWhenReady: true },
      data: { isPublished: true, publishWhenReady: false },
    });
  }

  async receiveWebhook(remote: StreamVideo) {
    if (!remote || typeof remote.uid !== 'string')
      throw new BadRequestException('Notification invalide');
    const job = await this.prisma.videoDelivery.findUnique({
      where: { remoteUid: remote.uid },
    });
    // An early notification can arrive before /copy returns. Polling will reconcile it.
    if (job) await this.reconcile(job.id, remote);
    return { received: true };
  }

  async retry(id: string) {
    if (!this.cloudflare.isEnabled())
      throw new ServiceUnavailableException(
        'Configurez Cloudflare avant de relancer',
      );
    const job = await this.prisma.videoDelivery.findUnique({ where: { id } });
    if (!job || job.status !== 'ERROR')
      throw new BadRequestException(
        'Seules les tâches en erreur peuvent être relancées',
      );
    const result = await this.prisma.videoDelivery.updateMany({
      where: { id, status: 'ERROR' },
      data: {
        status: 'RETRY',
        attempts: 0,
        leaseUntil: null,
        nextAttemptAt: new Date(),
        lastError: null,
        failureCode: null,
        processingStartedAt: new Date(),
        ...(job.failureCode === 'ENCODING_FAILED' ? { remoteUid: null } : {}),
      },
    });
    if (!result.count)
      throw new BadRequestException(
        'Seules les tâches en erreur peuvent être relancées',
      );
    return { queued: true };
  }

  async overview() {
    const [groups, jobs] = await Promise.all([
      this.prisma.videoDelivery.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.videoDelivery.findMany({
        take: 50,
        orderBy: { updatedAt: 'desc' },
        include: {
          mediaAsset: {
            select: { title: true, originalBucket: true, originalObject: true },
          },
        },
      }),
    ]);
    return {
      configuration: this.cloudflare.configuration(),
      counts: Object.fromEntries(groups.map((g) => [g.status, g._count._all])),
      jobs: jobs.map(({ mediaAsset, ...job }) => ({
        id: job.id,
        mediaAssetId: job.mediaAssetId,
        title: mediaAsset.title,
        status: job.status,
        attempts: job.attempts,
        lastError: job.lastError,
        updatedAt: job.updatedAt,
        originalRetained: !!(
          mediaAsset.originalBucket && mediaAsset.originalObject
        ),
      })),
    };
  }
}
