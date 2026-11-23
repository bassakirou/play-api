import { membershipExpiry } from '../monetization/creator-memberships';
import { accessPeriodFields, isPurchaseActive } from '../content-access/access-period';
import { validateLivePricing } from './live-pricing';
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { CloudflareStreamService } from '../video-delivery/cloudflare-stream.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLiveDto, UpdateLiveDto, AddCommentDto } from './dto/live.dto';
import { MinioService } from '../storage/minio.service';
import { MailService } from '../mail/mail.service';
import { randomUUID, createHmac } from 'crypto';
import { execFile } from 'child_process';
import { createWriteStream } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';

@Injectable()
export class LivesService {
  private readonly logger = new Logger(LivesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minioService: MinioService,
    private readonly cloudflare: CloudflareStreamService,
    private readonly mailService: MailService,
  ) {}

  private syncingReplays = false;

  private async prefersCloudflare() {
    if (!this.cloudflare.isEnabled()) return false;
    const policy = await this.prisma.videoRoutingPolicy.findUnique({ where: { id: 'default' } });
    return policy?.mode !== 'LOCAL_ONLY';
  }

  async prepareBroadcast(id: string, userId: string) {
    const live = await this.prisma.liveStream.findUnique({ where: { id } });
    if (!live) throw new NotFoundException('Live introuvable.');
    if (live.userId !== userId) throw new ForbiddenException('Action non autorisée.');
    if (live.status !== 'LIVE' || live.streamUrl || live.cloudflareInputId ||
        !(await this.prefersCloudflare())) return { publishUrl: null };

    try {
      const input = await this.cloudflare.createLiveInput(id, live.isPrivate || live.livePrice > 0);
      let saved = false;
      try {
        const result = await this.prisma.liveStream.updateMany({
          where: { id, userId, status: 'LIVE', isPrivate: live.isPrivate, livePrice: live.livePrice, streamUrl: null, cloudflareInputId: null },
          data: { cloudflareInputId: input.uid },
        });
        saved = result.count === 1;
        return { publishUrl: saved ? input.publishUrl : null };
      } finally {
        if (!saved) await this.cloudflare.deleteLiveInput(input.uid);
      }
    } catch {
      this.logger.warn(`Cloudflare indisponible pour le direct ${id}`);
      return { publishUrl: null };
    }
  }

  private async releaseBroadcast(id: string, uid: string) {
    try {
      await this.cloudflare.deleteLiveInput(uid);
      await this.prisma.liveStream.updateMany({
        where: { id, cloudflareInputId: uid },
        data: { cloudflareInputId: null },
      });
    } catch {
      this.logger.warn(`Suppression Cloudflare à réessayer pour le direct ${id}`);
    }
  }

  async syncCloudflareReplays() {
    if (this.syncingReplays) return;
    this.syncingReplays = true;
    try {
      if (!(await this.prefersCloudflare())) return;
      const now = new Date();
      const pending = await this.prisma.liveStream.findMany({
        where: {
          status: 'REPLAY', isCleanedUp: false,
          OR: [{ cleanupAt: { gt: now } }, { cleanupAt: null, replayPrice: { gt: 0 } }],
          replaySourceObject: { not: null }, cloudflareReplayStatus: 'PENDING',
        },
      });
      for (const live of pending) {
        const objectName = live.replaySourceObject!;
        const reference = `live-replay-${objectName.split('/').pop()}`;
        try {
          let remote = live.cloudflareReplayId
            ? await this.cloudflare.inspect(live.cloudflareReplayId)
            : await this.cloudflare.findCopy(reference);
          if (!remote) {
            const options = { bucket: 'videos' as const, expiresSeconds: 21600 };
            let source = await this.minioService.presignGet({ ...options, objectName });
            if (!source.startsWith('https://')) continue;
            if (live.type === 'radio') {
              const normalized = await this.normalizeRadioReplay(objectName);
              const stillRetained = await this.prisma.liveStream.findFirst({
                where: { id: live.id, status: 'REPLAY', replaySourceObject: objectName, OR: [{ cleanupAt: { gt: new Date() } }, { cleanupAt: null, replayPrice: { gt: 0 } }] },
                select: { id: true },
              });
              if (!stillRetained) {
                await this.minioService.removeObject('videos', normalized, true);
                continue;
              }
              source = await this.minioService.presignGet({ ...options, objectName: normalized });
            }
            remote = await this.cloudflare.copy(source, reference);
          }
          const result = await this.prisma.liveStream.updateMany({
            where: { id: live.id, status: 'REPLAY', replaySourceObject: objectName, OR: [{ cleanupAt: { gt: new Date() } }, { cleanupAt: null, replayPrice: { gt: 0 } }] },
            data: {
              cloudflareReplayId: remote.uid,
              cloudflareReplayStatus: remote.status?.state === 'error' ? 'FAILED'
                : remote.readyToStream && remote.status?.state === 'ready' ? 'READY' : 'PENDING',
            },
          });
          if (!result.count) {
            await this.cloudflare.deleteVideo(remote.uid);
            if (live.type === 'radio') await this.minioService.removeObject('videos', `${objectName}.stream.mp4`, true);
          }
        } catch {
          this.logger.warn(`Synchronisation du replay Cloudflare à réessayer pour ${live.id}`);
        }
      }
    } finally {
      this.syncingReplays = false;
    }
  }

  private async normalizeRadioReplay(objectName: string) {
    const normalized = `${objectName}.stream.mp4`;
    if (await this.minioService.objectExists('videos', normalized)) return normalized;
    const directory = await mkdtemp(join(tmpdir(), 'pyramidplay-radio-'));
    try {
      const input = join(directory, 'source');
      const output = join(directory, 'replay.mp4');
      const { stream } = await this.minioService.getObjectStream('videos', objectName);
      await pipeline(stream, createWriteStream(input));
      // Stream needs a video track for VOD; the unmodified audio recording remains in MinIO.
      await promisify(execFile)('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        'color=c=0x0f172a:s=640x360:r=5', '-i', input, '-map', '0:v:0',
        '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
        '-movflags', '+faststart', output,
      ], { timeout: 300_000, windowsHide: true });
      await this.minioService.uploadVideoFile(normalized, output, 'video/mp4');
      return normalized;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private generateEmailSignature(email: string, accessKey: string): string {
    const secret = process.env.JWT_SECRET || 'pyramidplay-live-private-secret';
    return createHmac('sha256', secret)
      .update(`${email.toLowerCase().trim()}:${accessKey}`)
      .digest('hex')
      .substring(0, 16);
  }

  async findAll(query?: {
    category?: string;
    type?: string;
    status?: string;
    search?: string;
    isAcademic?: boolean;
    userId?: string;
  }) {
    const where: any = {
      isPrivate: false, // Ne JAMAIS afficher les lives privés dans le catalogue public
    };

    if (query?.category && query.category !== 'all') {
      if (query.category === 'academic') {
        where.OR = [
          { category: 'academic' },
          { isAcademic: true },
        ];
      } else {
        where.category = query.category;
      }
    }
    if (query?.isAcademic !== undefined) {
      where.isAcademic = query.isAcademic;
    }
    if (query?.type && query.type !== 'all') {
      where.type = query.type;
    }
    if (query?.status) {
      if (query.status !== 'all') {
        where.status = query.status;
      }
    } else {
      // Exclure uniquement les lives terminés (conserver LIVE, SCHEDULED et REPLAY)
      where.status = { notIn: ['ENDED'] };
    }
    if (query?.search && query.search.trim()) {
      where.OR = [
        { title: { contains: query.search.trim(), mode: 'insensitive' } },
        { description: { contains: query.search.trim(), mode: 'insensitive' } },
        { tags: { has: query.search.trim() } },
      ];
    }

    const lives = await this.prisma.liveStream.findMany({
      where,
      orderBy: [
        { isFeatured: 'desc' },
        { status: 'asc' }, // LIVE first
        { viewerCount: 'desc' },
        { createdAt: 'desc' },
      ],
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            artistProfile: {
              select: {
                id: true,
                name: true,
                imageUrl: true,
                certified: true,
              },
            },
          },
        },
        _count: {
          select: {
            comments: true,
            reactions: true,
          },
        },
      },
    });

    // Filtrer les lives "zombies" : statut LIVE mais créés depuis plus de 12h (hôte parti sans terminer)
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const activeLives = lives.filter((live) => {
      if (live.status === 'LIVE' && live.startedAt && new Date(live.startedAt) < twelveHoursAgo) {
        return false; // Exclure les zombies
      }
      return true;
    });

    return activeLives.map((live) => this.formatLiveItem(live));
  }

  async findOne(id: string, token?: string, sig?: string, userId?: string, includePlayback = true) {
    const live = await this.prisma.liveStream.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            systemRoles: true,
            artistProfile: {
              select: {
                id: true,
                name: true,
                imageUrl: true,
                certified: true,
              },
            },
          },
        },
        comments: {
          orderBy: { createdAt: 'asc' },
          take: 100,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                role: true,
                systemRoles: true,
                artistProfile: {
                  select: { imageUrl: true },
                },
              },
            },
          },
        },
        reactions: {
          orderBy: { count: 'desc' },
        },
      },
    });

    if (!live) {
      throw new NotFoundException('Session Live non trouvée.');
    }

    // Vérification de confidentialité pour les directs privés
    if (live.isPrivate) {
      const isOwner = userId && (live.userId === userId);
      const isTokenValid = Boolean(token && live.accessKey && token === live.accessKey);

      if (!isOwner && !isTokenValid) {
        throw new ForbiddenException(
          'Ce direct est privé. Veuillez utiliser le lien d\'accès ou l\'invitation qui vous a été transmise.',
        );
      }
    }

    const replay = live.status === 'REPLAY';
    const price = replay ? live.replayPrice : live.livePrice;
    const contentType = replay ? 'LIVE_REPLAY' : 'LIVE';
    const isOwner = Boolean(userId && live.userId === userId);
    const purchase = price > 0 && userId && !isOwner
      ? await this.prisma.userPurchasedContent.findUnique({
          where: { userId_contentId_contentType: { userId, contentId: id, contentType } },
        })
      : null;
    const hasPurchase = isPurchaseActive(purchase);
    const subscriptionEnd = price > 0 && !isOwner && !hasPurchase
      ? await membershipExpiry(this.prisma, userId, contentType, id) : null;
    const accessEnd = subscriptionEnd ?? purchase?.accessEndsAt;
    const hasPlaybackAccess = isOwner || !(price > 0) || hasPurchase || Boolean(subscriptionEnd);
    const formatted = this.formatLiveDetail(live);
    const enabled = includePlayback && hasPlaybackAccess && await this.prefersCloudflare();
    const replayAvailable = replay && !!live.replaySourceObject && !live.isCleanedUp &&
      (live.cleanupAt ? live.cleanupAt > new Date() : live.replayPrice > 0);
    let whepUrl: string | undefined;
    if (enabled && live.status === 'LIVE' && live.cloudflareInputId) {
      try {
        const signed = live.isPrivate || live.livePrice > 0;
        whepUrl = accessEnd
          ? await this.cloudflare.livePlaybackUrl(live.cloudflareInputId, signed, Math.floor(accessEnd.getTime() / 1000))
          : await this.cloudflare.livePlaybackUrl(live.cloudflareInputId, signed);
      } catch {
        this.logger.warn(`Lecture Cloudflare indisponible pour le direct ${id}`);
      }
    }
    let replayCloudflareUrl: string | undefined;
    let playbackExpiresAt: number | undefined;
    if (includePlayback && hasPlaybackAccess && replayAvailable && live.replaySourceObject) {
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = Math.min(now + 3600,
        live.cleanupAt ? Math.floor(live.cleanupAt.getTime() / 1000) : Infinity,
        accessEnd ? Math.floor(accessEnd.getTime() / 1000) : Infinity);
      if (expiresAt > now) {
        playbackExpiresAt = expiresAt;
        try {
          formatted.recordingUrl = await this.minioService.presignGet({
            bucket: 'videos', objectName: live.replaySourceObject,
            expiresSeconds: Math.min(3600, Math.max(1, expiresAt - Math.floor(Date.now() / 1000))),
          });
        } catch {
          this.logger.warn(`Lien de secours MinIO indisponible pour le replay ${id}`);
        }
        if (enabled && live.cloudflareReplayStatus === 'READY' && live.cloudflareReplayId) {
          try {
            replayCloudflareUrl = (await this.cloudflare.playback(live.cloudflareReplayId, expiresAt)).url;
          } catch {
            this.logger.warn(`Lecture Cloudflare indisponible pour le replay ${id}`);
          }
        }
      }
    }
    // Renvoyer l'accessKey et invitedEmails pour le créateur ou si autorisé
    return {
      ...formatted,
      whepUrl,
      hasPlaybackAccess,
      replayAvailable,
      purchaseStartsAt: subscriptionEnd ? null : purchase?.accessStartsAt ?? null,
      purchaseEndsAt: accessEnd ?? null,
      recordingUrl: includePlayback && hasPlaybackAccess ? formatted.recordingUrl : null,
      streamUrl: includePlayback && hasPlaybackAccess ? formatted.streamUrl : '',
      streamKey: isOwner ? live.streamKey : undefined,
      comments: hasPlaybackAccess ? formatted.comments : [],
      replayCloudflareUrl,
      playbackExpiresAt,
      replayCloudflarePending: enabled && replayAvailable && live.cloudflareReplayStatus === 'PENDING',
      isPrivate: live.isPrivate,
      privateAccessType: live.privateAccessType,
      accessKey: (live.userId === userId || token === live.accessKey) ? live.accessKey : undefined,
      invitedEmails: live.userId === userId ? live.invitedEmails : undefined,
    };
  }

  private assertCreator(user: { role?: { name: string } | null; systemRoles?: string[] } | null) {
    const creatorRoles = ['CREATOR', 'CREATEUR', 'AUTHOR', 'AUTEUR', 'ARTIST', 'ARTISTE', 'ACADEMIC', 'FORMATEUR', 'ENSEIGNANT', 'ADMIN', 'SUPER_ADMIN'];
    const roles = [user?.role?.name || '', ...(user?.systemRoles || [])];
    if (!roles.some(role => creatorRoles.includes(role.toUpperCase())))
      throw new ForbiddenException('Activez un profil créateur pour publier un direct.');
  }

  async create(userId: string, dto: CreateLiveDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true, artistProfile: true },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }

    this.assertCreator(user);

    const isScheduled = dto.status === 'SCHEDULED' || !!dto.scheduledAt;
    const initialStatus = isScheduled ? 'SCHEDULED' : (dto.status || 'LIVE');
    const scheduledDate = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    const startedDate = isScheduled ? null : new Date();

    const retentionDays = dto.retentionDays !== undefined ? dto.retentionDays : 3;
    validateLivePricing({ ...dto, retentionDays });
    const cleanupAt =
      retentionDays > 0
        ? new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)
        : null;

    const hostName =
      user.artistProfile?.name || user.name || user.email.split('@')[0];
    const defaultThumb =
      user.artistProfile?.imageUrl ||
      'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&h=675&fit=crop';

    const isPrivate = Boolean(dto.isPrivate);
    const privateAccessType = isPrivate ? (dto.privateAccessType || 'link') : null;
    const accessKey = isPrivate ? randomUUID().replace(/-/g, '') : null;
    const rawEmails = Array.isArray(dto.invitedEmails) ? dto.invitedEmails : [];
    const invitedEmails = isPrivate && privateAccessType === 'invite'
      ? rawEmails.map((e) => e.toLowerCase().trim()).filter((e) => Boolean(e) && e.includes('@'))
      : [];

    const created = await this.prisma.liveStream.create({
      data: {
        ...accessPeriodFields(dto),
        livePrice: dto.livePrice ?? 0,
        liveDiscountPrice: dto.liveDiscountPrice ?? null,
        replayPrice: dto.replayPrice ?? 0,
        replayDiscountPrice: dto.replayDiscountPrice ?? null,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        type: dto.type || 'video',
        category: dto.category || 'all',
        status: initialStatus,
        scheduledAt: scheduledDate,
        startedAt: startedDate,
        streamUrl: dto.streamUrl || null,
        playbackType: dto.playbackType || 'WEBRTC',
        aspectRatio: dto.aspectRatio || 'auto',
        thumbnailUrl: dto.thumbnailUrl || defaultThumb,
        coverUrl: dto.coverUrl || user.artistProfile?.imageUrl || null,
        tags: dto.tags || ['Live', 'PyramidPlay'],
        retentionDays,
        cleanupAt,
        isFeatured: dto.isFeatured || false,
        isAcademic: Boolean(dto.isAcademic) || dto.category === 'academic',
        isPrivate,
        privateAccessType,
        accessKey,
        invitedEmails,
        userId: user.id,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            artistProfile: true,
          },
        },
      },
    });

    this.logger.log(`[LivesService] Nouveau live ${initialStatus} (Privé: ${isPrivate}): ${created.id} par ${hostName}`);

    // Si le live est privé avec invitation par email, envoyer les invitations avec signature unique
    if (isPrivate && privateAccessType === 'invite' && invitedEmails.length > 0 && accessKey) {
      const appUrl = (process.env.APP_WEB_URL || 'http://localhost:5173').replace(/\/+$/, '');
      for (const email of invitedEmails) {
        const sig = this.generateEmailSignature(email, accessKey);
        const privateLiveUrl = `${appUrl}/live/watch/${created.id}?token=${accessKey}&sig=${sig}`;
        this.mailService.sendLivePrivateInvitation({
          to: email,
          hostName,
          liveTitle: created.title,
          liveUrl: privateLiveUrl,
          scheduledAt: created.scheduledAt ? created.scheduledAt.toISOString() : undefined,
        }).catch((err) => {
          this.logger.error(`[LivesService] Échec invitation mail à ${email}: ${err.message}`);
        });
      }
    }

    const formatted = this.formatLiveItem(created);
    return {
      ...formatted,
      isPrivate: created.isPrivate,
      privateAccessType: created.privateAccessType,
      accessKey: created.accessKey,
      invitedEmails: created.invitedEmails,
    };
  }

  async update(id: string, userId: string, dto: UpdateLiveDto, isAdmin = false) {
    const live = await this.prisma.liveStream.findUnique({ where: { id } });
    if (!live) {
      throw new NotFoundException('Live non trouvé.');
    }

    if (live.userId !== userId && !isAdmin) {
      throw new ForbiddenException('Vous n\'avez pas le droit de modifier ce Live.');
    }

    if (dto.isPrivate !== undefined && dto.isPrivate !== live.isPrivate && live.cloudflareInputId) {
      throw new BadRequestException('Terminez ce direct avant de modifier sa confidentialité.');
    }
    const next = { ...live, ...dto };
    validateLivePricing(next);
    if ((live.livePrice > 0) !== (Number(next.livePrice) > 0) && live.status !== 'SCHEDULED')
      throw new BadRequestException('Le mode gratuit ou payant du direct ne peut être changé qu’avant son démarrage.');
    if (live.replaySourceObject && (live.replayPrice > 0) !== (Number(next.replayPrice) > 0))
      throw new BadRequestException('Le mode gratuit ou payant du replay doit être choisi avant son enregistrement.');
    if ((next.livePrice || next.replayPrice) && (dto.status !== undefined || dto.recordingUrl !== undefined))
      throw new BadRequestException('Utilisez les commandes de diffusion ou d’enregistrement pour changer l’état d’un live payant.');
    const data: any = { ...dto, ...accessPeriodFields(dto) };
    if (dto.livePrice === null) data.livePrice = 0;
    if (dto.replayPrice === null) data.replayPrice = 0;
    if (typeof dto.isAcademic !== 'undefined') {
      data.isAcademic = Boolean(dto.isAcademic);
    }
    if (dto.category === 'academic') {
      data.isAcademic = true;
    }
    if (dto.retentionDays !== undefined) {
      data.cleanupAt =
        dto.retentionDays > 0
          ? new Date(Date.now() + dto.retentionDays * 24 * 60 * 60 * 1000)
          : null;
    }

    if (next.replayPrice && live.replaySourceObject) data.cleanupAt = null;
    const updated = await this.prisma.liveStream.update({
      where: { id, status: live.status, replayPrice: live.replayPrice, livePrice: live.livePrice, replaySourceObject: live.replaySourceObject, ...(dto.isPrivate !== undefined && dto.isPrivate !== live.isPrivate ? { cloudflareInputId: null } : {}) },
      data,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            artistProfile: true,
          },
        },
      },
    });

    return this.formatLiveItem(updated);
  }

  async startLive(id: string, userId: string, isAdmin = false) {
    const live = await this.prisma.liveStream.findUnique({ where: { id } });
    if (!live) throw new NotFoundException('Live introuvable.');
    if (live.userId !== userId && !isAdmin) {
      throw new ForbiddenException('Action non autorisée.');
    }

    this.assertCreator(await this.prisma.user.findUnique({ where: { id: userId }, include: { role: true } }));
    if (live.status !== 'SCHEDULED')
      throw new BadRequestException('Seul un direct programmé peut être démarré.');
    return this.prisma.liveStream.update({
      where: { id, status: 'SCHEDULED' },
      data: {
        status: 'LIVE',
        startedAt: new Date(),
      },
    });
  }

  async endLive(id: string, userId: string, isAdmin = false) {
    const live = await this.prisma.liveStream.findUnique({ where: { id } });
    if (!live) throw new NotFoundException('Live introuvable.');
    if (live.userId !== userId && !isAdmin) {
      throw new ForbiddenException('Action non autorisée.');
    }

    const newStatus = (live.retentionDays > 0 && live.recordingUrl) ? 'REPLAY' : 'ENDED';
    const cleanupAt = live.retentionDays > 0 && !(live.replayPrice > 0 && live.replaySourceObject)
      ? new Date(Date.now() + live.retentionDays * 24 * 60 * 60 * 1000)
      : null;

    const ended = await this.prisma.liveStream.update({
      where: { id },
      data: {
        status: newStatus,
        endedAt: new Date(),
        cleanupAt,
      },
    });

    if (ended.cloudflareInputId) await this.releaseBroadcast(id, ended.cloudflareInputId);

    // Si retentionDays === 0, suppression immédiate des données média temporaires
    if (live.retentionDays === 0) {
      this.logger.log(`[LivesService] Rétention 0 jour : Nettoyage immédiat pour ${id}`);
      await this.deleteLiveRecordings(live);
    }

    return ended;
  }

  async toggleLike(id: string, liked: boolean) {
    const live = await this.prisma.liveStream.findUnique({
      where: { id },
      select: { id: true, likesCount: true },
    });
    if (!live) throw new NotFoundException('Live introuvable.');

    const newCount = liked ? live.likesCount + 1 : Math.max(0, live.likesCount - 1);
    const updated = await this.prisma.liveStream.update({
      where: { id },
      data: { likesCount: newCount },
      select: { id: true, likesCount: true },
    });

    return updated;
  }

  async uploadRecording(id: string, file: any, userId: string, isAdmin = false) {
    const live = await this.prisma.liveStream.findUnique({ where: { id } });
    if (!live) throw new NotFoundException('Live introuvable.');
    if (live.userId !== userId && !isAdmin) {
      throw new ForbiddenException('Action non autorisée.');
    }
    if (!file) throw new BadRequestException('Fichier vidéo manquant.');

    if (live.retentionDays <= 0 || live.isCleanedUp || live.replaySourceObject ||
        (live.endedAt && live.cleanupAt && live.cleanupAt <= new Date())) {
      throw new BadRequestException('Ce live ne peut plus recevoir d’enregistrement.');
    }

    const contentType = (file.mimetype || 'video/webm').split(';')[0];
    if (!/^(audio|video)\/(webm|mp4)$/.test(contentType)) {
      throw new BadRequestException('Format de replay non pris en charge.');
    }
    const extension = contentType.endsWith('/mp4') ? 'mp4' : 'webm';
    const objectName = `lives/recordings/${id}_${randomUUID()}.${extension}`;
    const recordingUrl = await this.minioService.upload({
      bucket: 'videos', objectName, buffer: file.buffer, contentType,
    });
    let saved = false;
    try {
      const result = await this.prisma.liveStream.updateMany({
        where: { id, retentionDays: { gt: 0 }, isCleanedUp: false, replaySourceObject: null, replayPrice: live.replayPrice,
          status: { in: live.replayPrice > 0 ? ['ENDED'] : ['LIVE', 'ENDED', 'REPLAY'] },
          OR: [{ endedAt: null }, { cleanupAt: { gt: new Date() } }] },
        data: {
          recordingUrl, streamUrl: null, replaySourceObject: objectName,
          playbackType: 'EXTERNAL', isRecorded: true,
          status: 'REPLAY',
          cleanupAt: live.replayPrice > 0 ? null : new Date(Date.now() + live.retentionDays * 86400_000),
        },
      });
      saved = result.count === 1;
      if (!saved) throw new BadRequestException('Ce live ne peut plus recevoir d’enregistrement.');
    } finally {
      if (!saved) await this.minioService.removeObject('videos', objectName);
    }
    return this.findOne(id, live.accessKey ?? undefined, undefined, userId);
  }

  async addComment(liveId: string, userId: string | null, dto: AddCommentDto) {
    const live = await this.prisma.liveStream.findUnique({ where: { id: liveId } });
    if (!live) throw new NotFoundException('Live introuvable.');

    let authorName = dto.userName || 'Spectateur';
    let authorAvatar = dto.userAvatar || null;
    let role = dto.role || 'USER';

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { role: true, artistProfile: true },
      });
      if (user) {
        authorName = user.artistProfile?.name || user.name || user.email.split('@')[0];
        authorAvatar = user.artistProfile?.imageUrl || null;
        if (live.userId === userId) {
          role = 'HOST';
        } else if (user.role?.name === 'ADMIN') {
          role = 'ADMIN';
        } else if (user.systemRoles?.includes('CREATOR')) {
          role = 'CREATOR';
        } else {
          role = 'VIP';
        }
      }
    }

    const comment = await this.prisma.liveComment.create({
      data: {
        liveId,
        userId,
        userName: authorName,
        userAvatar: authorAvatar,
        role,
        text: dto.text.trim(),
      },
    });

    return comment;
  }

  async addReaction(liveId: string, emoji: string) {
    const live = await this.prisma.liveStream.findUnique({ where: { id: liveId } });
    if (!live) throw new NotFoundException('Live introuvable.');

    // Incrémenter les likes si cœur ou flamme
    if (emoji === '❤️' || emoji === '🔥') {
      await this.prisma.liveStream.update({
        where: { id: liveId },
        data: { likesCount: { increment: 1 } },
      });
    }

    // Sauvegarder la réaction agrégée
    const existing = await this.prisma.liveReaction.findFirst({
      where: { liveId, emoji },
    });

    if (existing) {
      return this.prisma.liveReaction.update({
        where: { id: existing.id },
        data: { count: { increment: 1 } },
      });
    } else {
      return this.prisma.liveReaction.create({
        data: {
          liveId,
          emoji,
          count: 1,
        },
      });
    }
  }

  async updateViewerCount(liveId: string, count: number) {
    const live = await this.prisma.liveStream.findUnique({ where: { id: liveId } });
    if (!live) return null;

    const peak = Math.max(live.peakViewers, count);
    return this.prisma.liveStream.update({
      where: { id: liveId },
      data: {
        viewerCount: count,
        peakViewers: peak,
      },
    });
  }

  async deleteLive(id: string, userId: string, isAdmin = false) {
    const live = await this.prisma.liveStream.findUnique({ where: { id } });
    if (!live) throw new NotFoundException('Live non trouvé.');
    if (live.userId && live.userId !== userId && !isAdmin) {
      throw new ForbiddenException('Action non autorisée.');
    }

    if (live.replayPrice > 0 && live.replaySourceObject)
      throw new BadRequestException('Ce replay payant est conservé pour garantir les accès des acheteurs.');
    if (live.livePrice > 0 && ['LIVE', 'SCHEDULED'].includes(live.status))
      throw new BadRequestException('Terminez la session payante avant de la supprimer.');
    if (live.cloudflareInputId) await this.cloudflare.deleteLiveInput(live.cloudflareInputId);
    await this.deleteLiveRecordings(live);
    return this.prisma.liveStream.delete({ where: { id } });
  }

  /**
   * Tâche de nettoyage automatique des fichiers éphémères expirés
   */
  async cleanupExpiredLives() {
    const now = new Date();
    let totalCleaned = 0;

    // 1. Purge des lives dont la rétention est expirée
    const expiredLives = await this.prisma.liveStream.findMany({
      where: {
        status: { in: ['ENDED', 'REPLAY'] },
        isCleanedUp: false,
        OR: [
          { cleanupAt: { lte: now } },
          { retentionDays: 0 },
        ],
      },
    });

    this.logger.log(
      `[LiveCleanup] Vérification rétention : ${expiredLives.length} live(s) à purger.`,
    );

    const stoppedInputs = await this.prisma.liveStream.findMany({
      where: { status: { not: 'LIVE' }, cloudflareInputId: { not: null } },
      select: { id: true, cloudflareInputId: true },
    });
    for (const live of stoppedInputs) await this.releaseBroadcast(live.id, live.cloudflareInputId!);

    for (const live of expiredLives) {
      try {
        await this.deleteLiveRecordings(live);
        await this.prisma.liveStream.update({
          where: { id: live.id },
          data: { isCleanedUp: true, status: 'ENDED', recordingUrl: null, streamUrl: null,
            cloudflareReplayId: null, cloudflareReplayStatus: 'PENDING', replaySourceObject: null },
        });
        this.logger.log(`[LiveCleanup] Purge média réussie pour live ${live.id}`);
        totalCleaned++;
      } catch (err: any) {
        this.logger.error(`[LiveCleanup] Erreur purge live ${live.id}: ${err.message}`);
      }
    }

    // 2. Auto-terminer les lives "zombies" (statut LIVE depuis plus de 12h)
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const zombieLives = await this.prisma.liveStream.findMany({
      where: {
        status: 'LIVE',
        startedAt: { lte: twelveHoursAgo },
      },
    });

    if (zombieLives.length > 0) {
      this.logger.log(
        `[LiveCleanup] ${zombieLives.length} live(s) zombie(s) détecté(s) (LIVE > 12h). Terminaison automatique...`,
      );
    }

    for (const zombie of zombieLives) {
      try {
        await this.prisma.liveStream.update({
          where: { id: zombie.id },
          data: {
            status: 'ENDED',
            endedAt: now,
          },
        });
        if (zombie.cloudflareInputId) await this.releaseBroadcast(zombie.id, zombie.cloudflareInputId);
        this.logger.log(`[LiveCleanup] Live zombie ${zombie.id} ("${zombie.title}") terminé automatiquement.`);
        totalCleaned++;
      } catch (err: any) {
        this.logger.error(`[LiveCleanup] Erreur terminaison zombie ${zombie.id}: ${err.message}`);
      }
    }

    return { cleanedCount: totalCleaned };
  }

  private async deleteLiveRecordings(live: any) {
    if (live.cloudflareReplayId) await this.cloudflare.deleteVideo(live.cloudflareReplayId);
    if (live.replaySourceObject) {
      if (live.type === 'radio') {
        await this.minioService.removeObject('videos', `${live.replaySourceObject}.stream.mp4`, true);
      }
      await this.minioService.removeObject('videos', live.replaySourceObject, true);
      return;
    }
    if (live.recordingUrl) {
      try {
        this.logger.log(`[LivesService] Suppression de l'enregistrement: ${live.recordingUrl}`);
        const parts = live.recordingUrl.split('/');
        const videoIdx = parts.findIndex((p: string) => p === 'videos' || p === 'play-videos');
        const objectName = videoIdx !== -1 ? parts.slice(videoIdx + 1).join('/') : '';
        if (objectName) {
          await this.minioService.removeObject('videos', objectName);
        }
      } catch (err: any) {
        this.logger.warn(`[LivesService] Echec suppression recording: ${err.message}`);
      }
    }
  }

  private formatLiveItem(live: any) {
    const hostName =
      live.user?.artistProfile?.name ||
      live.user?.name ||
      live.user?.email?.split('@')[0] ||
      'Pyramid Live';
    const hostAvatar = live.user?.artistProfile?.imageUrl || null;

    return {
      id: live.id,
      title: live.title,
      description: live.description || '',
      type: live.type || 'video',
      category: live.category || 'all',
      status: live.status,
      aspectRatio: live.aspectRatio || 'auto',
      recordingUrl: live.replaySourceObject || live.replayPrice > 0 ? null : live.recordingUrl || null,
      isRecorded: Boolean(live.isRecorded || live.recordingUrl),
      streamUrl: live.replaySourceObject || live.livePrice > 0 || live.replayPrice > 0 ? '' : live.streamUrl || '',
      livePrice: live.livePrice,
      liveDiscountPrice: live.liveDiscountPrice,
      replayPrice: live.replayPrice,
      replayDiscountPrice: live.replayDiscountPrice,
      accessMode: live.accessMode,
      accessStartsAt: live.accessStartsAt,
      accessEndsAt: live.accessEndsAt,
      accessDurationDays: live.accessDurationDays,
      playbackType: live.playbackType,
      thumbnailUrl: live.thumbnailUrl || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&h=675&fit=crop',
      coverUrl: live.coverUrl || live.thumbnailUrl,
      hostName,
      hostAvatar,
      hostId: live.userId,
      isCertified: !!live.user?.artistProfile?.certified,
      viewerCount: live.viewerCount || 0,
      peakViewers: live.peakViewers || 0,
      likesCount: live.likesCount || 0,
      isFeatured: live.isFeatured || false,
      isAcademic: Boolean(live.isAcademic || live.category === 'academic'),
      isPrivate: Boolean(live.isPrivate),
      privateAccessType: live.privateAccessType || null,
      scheduledAt: live.scheduledAt,
      startedAt: live.startedAt || live.createdAt,
      endedAt: live.endedAt,
      retentionDays: live.retentionDays,
      tags: live.tags || ['Live'],
      commentsCount: live._count?.comments || 0,
      createdAt: live.createdAt,
    };
  }

  private formatLiveDetail(live: any) {
    const base = this.formatLiveItem(live);
    return {
      ...base,
      comments: (live.comments || []).map((c: any) => ({
        id: c.id,
        streamId: c.liveId,
        userId: c.userId,
        userName: c.userName,
        userAvatar:
          c.userAvatar ||
          c.user?.artistProfile?.imageUrl ||
          null,
        role: c.role || 'USER',
        text: c.text,
        timestamp: c.createdAt,
      })),
      reactions: live.reactions || [],
    };
  }
}
