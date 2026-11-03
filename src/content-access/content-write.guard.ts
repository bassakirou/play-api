import { MediaSourceOwnershipService } from './media-source-ownership.service';
import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verify } from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { AcademicSubscriptionService } from './academic-subscription.service';

@Injectable()
export class ContentWriteGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: AcademicSubscriptionService,
    private readonly config: ConfigService,
    private readonly mediaSources: MediaSourceOwnershipService = new MediaSourceOwnershipService(
      prisma,
      subscriptions,
    ),
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const method = String(req.method).toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return true;
    const path = String(req.path || req.url || '')
      .split('?')[0]
      .replace(/^\/api(?=\/)/i, '')
      .replace(/\/$/, '');
    const match =
      /^\/(songs|albums|videos|audiobooks)(?:\/([^/]+))?(.*)$/i.exec(path);
    if (!match) return true;
    const [, rawKind, segment, suffix] = match;
    const kind = rawKind.toLowerCase();
    const creation =
      method === 'POST' &&
      (!segment || (kind === 'videos' && segment?.toLowerCase() === 'me'));
    const chapterWrite =
      kind === 'audiobooks' &&
      /^\/chapters(?:\/[^/]+(?:\/sync)?)?$/i.test(suffix);
    const itemWrite =
      !!segment && !suffix && ['PUT', 'PATCH', 'DELETE'].includes(method);
    if (!creation && !chapterWrite && !itemWrite) return true;
    const bearer = /^Bearer (.+)$/i.exec(req.headers?.authorization || '')?.[1];
    let userId: string;
    try {
      const payload = verify(
        bearer || '',
        this.config.get<string>('JWT_SECRET') || 'secretKey',
        { algorithms: ['HS256'] },
      );
      if (
        typeof payload === 'string' ||
        typeof payload.sub !== 'string' ||
        !payload.sub
      )
        throw new Error();
      userId = payload.sub;
    } catch {
      throw new UnauthorizedException('Authentification nécessaire');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user) throw new UnauthorizedException('Compte introuvable');
    const admin =
      user.systemRoles?.some((role) =>
        ['ADMIN', 'SUPER_ADMIN'].includes(role),
      ) || ['ADMIN', 'SUPER_ADMIN'].includes(user.role?.name || '');
    const body = req.body || (req.body = {});
    let item: any;
    if (!creation) {
      if (kind === 'songs')
        item = await this.prisma.song.findUnique({
          where: { id: segment },
          include: { artists: true },
        });
      if (kind === 'albums')
        item = await this.prisma.album.findUnique({
          where: { id: segment },
          include: { artist: true },
        });
      if (kind === 'videos')
        item = await this.prisma.video.findUnique({
          where: { id: segment },
          include: { artists: true },
        });
      if (kind === 'audiobooks')
        item = await this.prisma.audiobook.findUnique({
          where: { id: segment },
          include: { chapters: true },
        });
      if (!item) throw new NotFoundException('Contenu introuvable');
      const owner =
        item.userId === userId ||
        item.authorId === userId ||
        item.artist?.userId === userId ||
        item.artists?.some((artist: any) => artist.userId === userId);
      if (!admin && !owner)
        throw new ForbiddenException(
          'Seul le propriétaire peut modifier ce contenu',
        );
    }
    if (method !== 'DELETE') {
      if (body.isAcademic !== undefined && typeof body.isAcademic !== 'boolean')
        throw new BadRequestException('isAcademic doit être un booléen');
      if (item?.isAcademic || body.isAcademic)
        await this.subscriptions.assertCanPublish(userId);
      if (!chapterWrite) this.validatePrice({ ...item, ...body });
      if (kind === 'audiobooks' && (creation || body.authorId !== undefined)) {
        if (!admin && body.authorId && body.authorId !== userId)
          throw new ForbiddenException('Auteur non autorisé');
        if (!admin || !body.authorId) body.authorId = userId;
      }
      if (!admin) {
        if (body.userId !== undefined && body.userId !== userId)
          throw new ForbiddenException('Propriétaire non autorisé');
        if (kind === 'songs' && body.albumId) {
          const album = await this.prisma.album.findUnique({
            where: { id: body.albumId },
            include: { artist: true },
          });
          if (album?.artist?.userId !== userId)
            throw new ForbiddenException('Album non autorisé');
        }
        if (
          body.artistId === null ||
          (Array.isArray(body.artistIds) && !body.artistIds.length)
        ) {
          if (!creation)
            throw new ForbiddenException(
              'Le propriétaire du contenu doit être conservé',
            );
        }
        if (
          creation &&
          kind === 'songs' &&
          Array.isArray(body.groupIds) &&
          body.groupIds.length &&
          !body.artistId &&
          !body.artistIds?.length
        ) {
          const artist = await this.prisma.artist.findFirst({
            where: { userId },
          });
          if (!artist)
            throw new ForbiddenException(
              'Un profil artiste est nécessaire pour publier au nom du groupe',
            );
          body.artistIds = [artist.id];
        }
        const artistId =
          body.artistId ||
          (Array.isArray(body.artistIds) ? body.artistIds[0] : undefined);
        if (artistId) {
          const artist = await this.prisma.artist.findUnique({
            where: { id: artistId },
          });
          if (artist?.userId !== userId)
            throw new ForbiddenException('Artiste principal non autorisé');
        }
        if (creation && kind === 'albums' && !artistId) {
          const artist = await this.prisma.artist.findFirst({
            where: { userId },
          });
          if (!artist)
            throw new ForbiddenException('Un profil artiste est nécessaire');
          body.artistId = artist.id;
        }
      }
      if (
        kind === 'songs' &&
        typeof body.audioUrl === 'string' &&
        body.audioUrl.startsWith('pyramidplay:audio:')
      ) {
        body.audioUrl = this.restoreReference(
          body.audioUrl,
          `pyramidplay:audio:SONG:${segment}`,
          item?.audioUrl,
        );
      }
      if (
        kind === 'videos' &&
        typeof body.videoUrl === 'string' &&
        body.videoUrl.startsWith('pyramidplay:video:')
      ) {
        body.videoUrl = this.restoreReference(
          body.videoUrl,
          `pyramidplay:video:${segment}`,
          item?.videoUrl,
        );
      }
      if (kind === 'audiobooks') {
        const restoreChapter = (chapter: any, chapterId?: string) => {
          if (
            typeof chapter.audioUrl !== 'string' ||
            !chapter.audioUrl.startsWith('pyramidplay:audio:')
          )
            return;
          const existing = item?.chapters?.find(
            (entry: any) => entry.id === chapterId,
          );
          chapter.audioUrl = this.restoreReference(
            chapter.audioUrl,
            `pyramidplay:audio:AUDIOBOOK:${segment}:${chapterId}`,
            existing?.audioUrl,
          );
        };
        if (Array.isArray(body.chapters))
          body.chapters.forEach((chapter: any) =>
            restoreChapter(chapter, chapter.id),
          );
        restoreChapter(body, suffix.split('/')[2]);
      }
      if (kind === 'songs' && body.audioUrl !== undefined)
        body.audioUrl = await this.mediaSources.resolve(
          body.audioUrl,
          userId,
          item?.audioUrl,
        );
      if (kind === 'videos' && body.videoUrl !== undefined)
        body.videoUrl = await this.mediaSources.resolve(
          body.videoUrl,
          userId,
          item?.videoUrl,
        );
      if (kind === 'audiobooks') {
        if (Array.isArray(body.chapters)) {
          for (const chapter of body.chapters) {
            if (chapter.audioUrl !== undefined)
              chapter.audioUrl = await this.mediaSources.resolve(
                chapter.audioUrl,
                userId,
                item?.chapters?.find((entry: any) => entry.id === chapter.id)
                  ?.audioUrl,
              );
          }
        }
        if (body.audioUrl !== undefined)
          body.audioUrl = await this.mediaSources.resolve(
            body.audioUrl,
            userId,
            item?.chapters?.find(
              (entry: any) => entry.id === suffix.split('/')[2],
            )?.audioUrl,
          );
      }
    }
    return true;
  }

  private restoreReference(
    reference: string,
    expected: string,
    source?: string,
  ) {
    if (reference !== expected || !source || source.startsWith('pyramidplay:'))
      throw new BadRequestException('Référence de média invalide');
    return source;
  }

  private validatePrice(item: any) {
    if (item.isMonetized !== undefined && typeof item.isMonetized !== 'boolean')
      throw new BadRequestException('isMonetized doit être un booléen');
    if (
      item.price != null &&
      (!Number.isSafeInteger(item.price) || item.price < 0)
    )
      throw new BadRequestException(
        'Le prix doit être un entier positif ou nul',
      );
    if (
      item.isMonetized &&
      (!Number.isSafeInteger(item.price) || item.price <= 0)
    )
      throw new BadRequestException(
        'Un contenu payant doit avoir un prix positif',
      );
    if (
      item.discountPrice != null &&
      (!Number.isSafeInteger(item.price) ||
        !Number.isSafeInteger(item.discountPrice) ||
        item.discountPrice <= 0 ||
        item.discountPrice >= item.price)
    )
      throw new BadRequestException(
        'La remise doit être positive et inférieure au prix',
      );
  }
}
