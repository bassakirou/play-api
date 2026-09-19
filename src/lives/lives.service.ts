/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLiveDto, UpdateLiveDto, AddCommentDto } from './dto/live.dto';
import { MinioService } from '../storage/minio.service';
import { HlsTranscoderService } from '../storage/hls-transcoder.service';
import { MailService } from '../mail/mail.service';
import { randomUUID, createHmac } from 'crypto';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

@Injectable()
export class LivesService {
  private readonly logger = new Logger(LivesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minioService: MinioService,
    private readonly hlsTranscoder: HlsTranscoderService,
    private readonly mailService: MailService,
  ) {}

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
      where.status = { not: 'ENDED' };
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

    return lives.map((live) => this.formatLiveItem(live));
  }

  async findOne(id: string, token?: string, sig?: string, userId?: string) {
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

    const formatted = this.formatLiveDetail(live);
    // Renvoyer l'accessKey et invitedEmails pour le créateur ou si autorisé
    return {
      ...formatted,
      isPrivate: live.isPrivate,
      privateAccessType: live.privateAccessType,
      accessKey: (live.userId === userId || token === live.accessKey) ? live.accessKey : undefined,
      invitedEmails: live.userId === userId ? live.invitedEmails : undefined,
    };
  }

  async create(userId: string, dto: CreateLiveDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true, artistProfile: true },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }

    const systemRoles = (user.systemRoles || []).map((r) => r.toUpperCase());
    const roleName = (user.role?.name || '').toUpperCase();
    const isCreator =
      systemRoles.includes('CREATOR') ||
      systemRoles.includes('CREATEUR') ||
      systemRoles.includes('AUTHOR') ||
      systemRoles.includes('AUTEUR') ||
      systemRoles.includes('ARTIST') ||
      systemRoles.includes('ARTISTE') ||
      systemRoles.includes('ACADEMIC') ||
      systemRoles.includes('FORMATEUR') ||
      systemRoles.includes('ENSEIGNANT') ||
      systemRoles.includes('ADMIN') ||
      systemRoles.includes('SUPER_ADMIN') ||
      roleName === 'CREATOR' ||
      roleName === 'CREATEUR' ||
      roleName === 'AUTHOR' ||
      roleName === 'AUTEUR' ||
      roleName === 'ARTIST' ||
      roleName === 'ARTISTE' ||
      roleName === 'ACADEMIC' ||
      roleName === 'FORMATEUR' ||
      roleName === 'ENSEIGNANT' ||
      roleName === 'ADMIN' ||
      roleName === 'SUPER_ADMIN' ||
      !!user.artistProfile;

    if (!isCreator) {
      throw new ForbiddenException(
        'Accès refusé : Seuls les utilisateurs avec un profil Studio (CREATOR, AUTHOR, ARTIST, ACADEMIC) ou ADMIN peuvent créer un Live.',
      );
    }

    const isScheduled = dto.status === 'SCHEDULED' || !!dto.scheduledAt;
    const initialStatus = isScheduled ? 'SCHEDULED' : (dto.status || 'LIVE');
    const scheduledDate = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    const startedDate = isScheduled ? null : new Date();

    const retentionDays = dto.retentionDays !== undefined ? dto.retentionDays : 3;
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

    const data: any = { ...dto };
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

    const updated = await this.prisma.liveStream.update({
      where: { id },
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

    return this.prisma.liveStream.update({
      where: { id },
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
    const cleanupAt = live.retentionDays > 0
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

    let recordingUrl = '';
    const tempDir = join(process.cwd(), 'uploads', 'temp_lives');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const tempInputFile = join(tempDir, `${id}_raw_${Date.now()}.webm`);

    try {
      // 1. Écrire le buffer temporaire sur le disque pour FFmpeg
      writeFileSync(tempInputFile, file.buffer);

      // 2. Transcoder vers HLS via HlsTranscoderService
      this.logger.log(`[LivesService] Début du transcodage HLS pour le live ${id}...`);
      const transcodeResult = await this.hlsTranscoder.generateVideoVariants({
        inputPath: tempInputFile,
        mediaId: `lives/${id}`,
      });

      recordingUrl = transcodeResult.masterUrl;
      this.logger.log(`[LivesService] Replay HLS généré et uploadé dans MinIO pour ${id}: ${recordingUrl}`);
    } catch (err: any) {
      this.logger.warn(`[LivesService] Échec du transcodage HLS: ${err.message}. Repli sur upload direct webm...`);
      // Fallback: upload direct MinIO .webm si ffmpeg échoue
      const filename = `lives/recordings/${id}_${Date.now()}.webm`;
      try {
        recordingUrl = await this.minioService.upload({
          bucket: 'videos',
          objectName: filename,
          buffer: file.buffer,
          contentType: file.mimetype || 'video/webm',
        });
      } catch (uploadErr: any) {
        this.logger.error(`[LivesService] Échec upload direct MinIO : ${uploadErr.message}`);
        recordingUrl = `/media/${filename}`;
      }
    } finally {
      // Nettoyage du fichier brut temporaire
      if (existsSync(tempInputFile)) {
        try {
          unlinkSync(tempInputFile);
        } catch {
          // ignore
        }
      }
    }

    const newStatus = live.retentionDays > 0 ? 'REPLAY' : live.status;
    const cleanupAt = live.retentionDays > 0
      ? new Date(Date.now() + live.retentionDays * 24 * 60 * 60 * 1000)
      : null;

    const isHls = recordingUrl.includes('.m3u8');

    const updated = await this.prisma.liveStream.update({
      where: { id },
      data: {
        recordingUrl,
        streamUrl: recordingUrl,
        playbackType: isHls ? 'HLS' : live.playbackType,
        isRecorded: true,
        status: newStatus,
        cleanupAt,
      },
    });

    this.logger.log(`[LivesService] Enregistrement sauvegardé pour le live ${id}: ${recordingUrl} (playback: ${isHls ? 'HLS' : live.playbackType})`);
    return this.formatLiveItem(updated);
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
    if (live.userId !== userId && !isAdmin) {
      throw new ForbiddenException('Action non autorisée.');
    }

    await this.deleteLiveRecordings(live);
    return this.prisma.liveStream.delete({ where: { id } });
  }

  /**
   * Tâche de nettoyage automatique des fichiers éphémères expirés
   */
  async cleanupExpiredLives() {
    const now = new Date();
    const expiredLives = await this.prisma.liveStream.findMany({
      where: {
        status: 'ENDED',
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

    for (const live of expiredLives) {
      try {
        await this.deleteLiveRecordings(live);
        await this.prisma.liveStream.update({
          where: { id: live.id },
          data: { isCleanedUp: true, recordingUrl: null },
        });
        this.logger.log(`[LiveCleanup] Purge média réussie pour live ${live.id}`);
      } catch (err: any) {
        this.logger.error(`[LiveCleanup] Erreur purge live ${live.id}: ${err.message}`);
      }
    }

    return { cleanedCount: expiredLives.length };
  }

  private async deleteLiveRecordings(live: any) {
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
      recordingUrl: live.recordingUrl || null,
      isRecorded: Boolean(live.isRecorded || live.recordingUrl),
      streamUrl: live.streamUrl || '',
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
      streamKey: live.streamKey,
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
