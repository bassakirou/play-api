import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../storage/minio.service';
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
  private readonly tokens = new Map<
    string,
    { url: string; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly cloudflare: CloudflareStreamService,
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
      isAdmin(caller) || (!!caller?.id && caller.id === video.userId);
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

  async playback(videoId: string, caller?: DeliveryCaller) {
    const video = await this.accessibleVideo(videoId, caller);
    const delivery = video.mediaAsset?.delivery;
    if (!delivery || delivery.status !== 'READY' || !delivery.remoteUid)
      throw new ServiceUnavailableException('Vidéo en cours de préparation');
    const cached = this.tokens.get(delivery.remoteUid);
    if (cached && cached.expiresAt > Date.now() / 1000 + 300) return cached;
    const token = await this.cloudflare.playback(delivery.remoteUid);
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
