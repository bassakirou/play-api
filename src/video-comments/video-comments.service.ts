import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../storage/minio.service';
import { CreateVideoCommentDto, QueryStudioCommentsDto } from './dto/video-comment.dto';

export interface VideoCommentFormatted {
  id: string;
  videoId: string;
  userId: string | null;
  userName: string;
  userAvatar: string | null;
  content: string;
  likes: number;
  isCreator: boolean;
  channelName: string | null;
  channelAvatar: string | null;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  replies?: VideoCommentFormatted[];
}

@Injectable()
export class VideoCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

  private async resolveAvatarUrl(url?: string | null): Promise<string | null> {
    if (!url) return null;
    return this.minio.refreshUrl(url);
  }

  /**
   * Récupère tous les commentaires d'une vidéo structurés sous forme d'arborescence (multi-niveaux)
   */
  async findByVideo(videoId: string): Promise<VideoCommentFormatted[]> {
    const rawComments = await (this.prisma as any).videoComment.findMany({
      where: { videoId },
      orderBy: { createdAt: 'asc' },
    });

    if (!rawComments || rawComments.length === 0) {
      return [];
    }

    // Hydrater les avatars
    const hydrated: VideoCommentFormatted[] = await Promise.all(
      rawComments.map(async (c: any) => ({
        id: c.id,
        videoId: c.videoId,
        userId: c.userId,
        userName: c.userName,
        userAvatar: await this.resolveAvatarUrl(c.userAvatar),
        content: c.content,
        likes: c.likes,
        isCreator: c.isCreator,
        channelName: c.channelName,
        channelAvatar: await this.resolveAvatarUrl(c.channelAvatar),
        parentId: c.parentId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        replies: [],
      })),
    );

    // Construire l'arborescence récursive
    const map = new Map<string, VideoCommentFormatted>();
    hydrated.forEach((item) => map.set(item.id, item));

    const rootComments: VideoCommentFormatted[] = [];

    hydrated.forEach((item) => {
      if (item.parentId && map.has(item.parentId)) {
        const parent = map.get(item.parentId)!;
        if (!parent.replies) parent.replies = [];
        parent.replies.push(item);
      } else {
        rootComments.push(item);
      }
    });

    // Trier les commentaires racines par date décroissante (les plus récents en haut)
    rootComments.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return rootComments;
  }

  /**
   * Création d'un nouveau commentaire ou d'une réponse (avec support du mode créateur / chaîne)
   */
  async create(
    videoId: string,
    userId: string,
    dto: CreateVideoCommentDto,
  ): Promise<VideoCommentFormatted> {
    const video = await (this.prisma as any).video.findUnique({
      where: { id: videoId },
      include: {
        user: {
          include: { artistProfile: true },
        },
      },
    });

    if (!video) {
      throw new NotFoundException('Vidéo introuvable.');
    }

    // Si c'est une réponse, vérifier que le parent existe et appartient à la même vidéo
    if (dto.parentId) {
      const parent = await (this.prisma as any).videoComment.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent) {
        throw new NotFoundException('Commentaire parent introuvable.');
      }
      if (parent.videoId !== videoId) {
        throw new BadRequestException('Le commentaire parent appartient à une autre vidéo.');
      }
    }

    // Récupérer les informations de l'utilisateur connecté
    const user = await (this.prisma as any).user.findUnique({
      where: { id: userId },
      include: { role: true, artistProfile: true },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }

    // Déterminer si l'utilisateur commente en tant que créateur
    const isVideoOwner = video.userId === userId;
    const hasCreatorProfile = Boolean(user.artistProfile || user.systemRoles?.includes('CREATOR') || user.role?.name === 'ADMIN' || user.role?.name === 'SUPER_ADMIN');
    const shouldPostAsCreator = isVideoOwner || (hasCreatorProfile && dto.isAsCreator === true);

    let channelName: string | null = null;
    let channelAvatar: string | null = null;
    let authorName = user.name || user.email.split('@')[0];
    let authorAvatar = user.artistProfile?.imageUrl || null;

    if (shouldPostAsCreator) {
      // Priorité au nom de chaîne de la vidéo si propriétaire, sinon profil artiste
      channelName = user.artistProfile?.name || video.user?.artistProfile?.name || authorName;
      channelAvatar = user.artistProfile?.imageUrl || video.user?.artistProfile?.imageUrl || null;
      authorName = channelName;
      authorAvatar = channelAvatar;
    }

    const created = await (this.prisma as any).videoComment.create({
      data: {
        videoId,
        userId,
        userName: authorName,
        userAvatar: authorAvatar,
        content: dto.content.trim(),
        isCreator: shouldPostAsCreator,
        channelName,
        channelAvatar,
        parentId: dto.parentId || null,
      },
    });

    return {
      id: created.id,
      videoId: created.videoId,
      userId: created.userId,
      userName: created.userName,
      userAvatar: await this.resolveAvatarUrl(created.userAvatar),
      content: created.content,
      likes: created.likes,
      isCreator: created.isCreator,
      channelName: created.channelName,
      channelAvatar: await this.resolveAvatarUrl(created.channelAvatar),
      parentId: created.parentId,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      replies: [],
    };
  }

  /**
   * Incrémenter les likes d'un commentaire
   */
  async like(commentId: string): Promise<{ id: string; likes: number }> {
    const comment = await (this.prisma as any).videoComment.findUnique({
      where: { id: commentId },
    });
    if (!comment) throw new NotFoundException('Commentaire introuvable.');

    const updated = await (this.prisma as any).videoComment.update({
      where: { id: commentId },
      data: { likes: { increment: 1 } },
      select: { id: true, likes: true },
    });

    return updated;
  }

  /**
   * Suppression d'un commentaire (par son auteur, par le créateur de la vidéo ou par un admin)
   */
  async delete(commentId: string, userId: string, userRoles: string[] = []): Promise<{ success: boolean }> {
    const comment = await (this.prisma as any).videoComment.findUnique({
      where: { id: commentId },
      include: { video: true },
    });

    if (!comment) throw new NotFoundException('Commentaire introuvable.');

    const isAdmin = userRoles.includes('ADMIN') || userRoles.includes('SUPER_ADMIN');
    const isAuthor = comment.userId === userId;
    const isVideoOwner = comment.video?.userId === userId;

    if (!isAdmin && !isAuthor && !isVideoOwner) {
      throw new ForbiddenException("Vous n'êtes pas autorisé à supprimer ce commentaire.");
    }

    await (this.prisma as any).videoComment.delete({
      where: { id: commentId },
    });

    return { success: true };
  }

  /**
   * Gestion dans Play-Studio : lister tous les commentaires reçus sur les vidéos du créateur
   */
  async findForStudio(creatorUserId: string, query: QueryStudioCommentsDto) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    // Récupérer toutes les vidéos du créateur
    const creatorVideos = await (this.prisma as any).video.findMany({
      where: { userId: creatorUserId },
      select: { id: true, title: true, thumbnailUrl: true },
    });

    const videoIds = creatorVideos.map((v: any) => v.id);

    if (videoIds.length === 0) {
      return {
        items: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
      };
    }

    const where: any = {
      videoId: query.videoId ? query.videoId : { in: videoIds },
    };

    if (query.search?.trim()) {
      where.OR = [
        { content: { contains: query.search.trim(), mode: 'insensitive' } },
        { userName: { contains: query.search.trim(), mode: 'insensitive' } },
      ];
    }

    const [rawComments, total] = await Promise.all([
      (this.prisma as any).videoComment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          video: {
            select: { id: true, title: true, thumbnailUrl: true },
          },
          replies: {
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      (this.prisma as any).videoComment.count({ where }),
    ]);

    const items = await Promise.all(
      rawComments.map(async (c: any) => ({
        id: c.id,
        videoId: c.videoId,
        videoTitle: c.video?.title || 'Vidéo',
        videoThumbnail: await this.resolveAvatarUrl(c.video?.thumbnailUrl),
        userId: c.userId,
        userName: c.userName,
        userAvatar: await this.resolveAvatarUrl(c.userAvatar),
        content: c.content,
        likes: c.likes,
        isCreator: c.isCreator,
        channelName: c.channelName,
        channelAvatar: await this.resolveAvatarUrl(c.channelAvatar),
        parentId: c.parentId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        replyCount: c.replies?.length || 0,
        replies: await Promise.all(
          (c.replies || []).map(async (r: any) => ({
            id: r.id,
            videoId: r.videoId,
            userId: r.userId,
            userName: r.userName,
            userAvatar: await this.resolveAvatarUrl(r.userAvatar),
            content: r.content,
            likes: r.likes,
            isCreator: r.isCreator,
            createdAt: r.createdAt,
          })),
        ),
      })),
    );

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Réponse rapide depuis le Creator Studio
   */
  async replyFromStudio(commentId: string, creatorUserId: string, content: string) {
    const parentComment = await (this.prisma as any).videoComment.findUnique({
      where: { id: commentId },
      include: {
        video: {
          include: {
            user: { include: { artistProfile: true } },
          },
        },
      },
    });

    if (!parentComment) {
      throw new NotFoundException('Commentaire introuvable.');
    }

    const video = parentComment.video;
    if (!video) {
      throw new NotFoundException('Vidéo associée introuvable.');
    }

    const creatorUser = await (this.prisma as any).user.findUnique({
      where: { id: creatorUserId },
      include: { role: true, artistProfile: true },
    });

    const isAdmin = creatorUser?.role?.name === 'ADMIN' || creatorUser?.role?.name === 'SUPER_ADMIN';
    if (video.userId !== creatorUserId && !isAdmin) {
      throw new ForbiddenException("Vous n'êtes pas le propriétaire de cette vidéo.");
    }

    const channelName = creatorUser?.artistProfile?.name || video.user?.artistProfile?.name || creatorUser?.name || 'Créateur';
    const channelAvatar = creatorUser?.artistProfile?.imageUrl || video.user?.artistProfile?.imageUrl || null;

    const reply = await (this.prisma as any).videoComment.create({
      data: {
        videoId: video.id,
        userId: creatorUserId,
        userName: channelName,
        userAvatar: channelAvatar,
        content: content.trim(),
        isCreator: true,
        channelName,
        channelAvatar,
        parentId: commentId,
      },
    });

    return {
      id: reply.id,
      videoId: reply.videoId,
      userId: reply.userId,
      userName: reply.userName,
      userAvatar: await this.resolveAvatarUrl(reply.userAvatar),
      content: reply.content,
      likes: reply.likes,
      isCreator: reply.isCreator,
      channelName: reply.channelName,
      channelAvatar: await this.resolveAvatarUrl(reply.channelAvatar),
      parentId: reply.parentId,
      createdAt: reply.createdAt,
      updatedAt: reply.updatedAt,
      replies: [],
    };
  }
}
