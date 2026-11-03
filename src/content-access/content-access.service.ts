import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export type ContentCaller = { id?: string; role?: string };
type Ticket = {
  type: string;
  contentId: string;
  chapterId?: string;
  userId?: string;
  expiresAt: number;
  source?: string;
};

@Injectable()
export class ContentAccessService {
  // An ephemeral key is safe in development and invalidates links on restart.
  private readonly secret =
    process.env.MEDIA_TICKET_SECRET ||
    process.env.JWT_SECRET ||
    randomBytes(32).toString('hex');
  constructor(private readonly prisma: PrismaService) {}

  async isAdmin(caller?: ContentCaller) {
    if (!caller?.id) return false;
    const user = await this.prisma.user.findUnique({
      where: { id: caller.id },
      include: { role: true },
    });
    return (
      !!user &&
      (['ADMIN', 'SUPER_ADMIN'].includes(user.role?.name || '') ||
        user.systemRoles?.some((r) => ['ADMIN', 'SUPER_ADMIN'].includes(r)))
    );
  }

  async purchased(type: string, id: string, caller?: ContentCaller) {
    if (!caller?.id) return false;
    return !!(await this.prisma.userPurchasedContent.findUnique({
      where: {
        userId_contentId_contentType: {
          userId: caller.id,
          contentId: id,
          contentType: type,
        },
      },
    }));
  }

  async canManage(item: any, caller?: ContentCaller): Promise<boolean> {
    if (!item) return false;
    const owner =
      caller?.id &&
      (item.userId === caller.id ||
        item.authorId === caller.id ||
        item.instructorId === caller.id ||
        item.artist?.userId === caller.id ||
        item.artists?.some((a: any) => a.userId === caller.id));
    return Boolean(owner || (await this.isAdmin(caller)));
  }

  async canAccess(
    type: string,
    item: any,
    caller?: ContentCaller,
  ): Promise<boolean> {
    if (!item) return false;
    if (await this.canManage(item, caller)) return true;
    if (['VIDEO', 'COURSE'].includes(type) && !item.isPublished) return false;
    if (type === 'VIDEO' && Number(item.price) <= 0) return true;
    const albumPaid = type === 'SONG' && item.album?.isMonetized;
    if (!item.isMonetized && !albumPaid) return true;
    if (await this.purchased(type, item.id, caller)) return true;
    if (
      type === 'SONG' &&
      item.albumId &&
      (await this.purchased('ALBUM', item.albumId, caller))
    )
      return true;
    return false;
  }

  async source(
    type: string,
    id: string,
    caller?: ContentCaller,
    chapterId?: string,
  ) {
    let item: any;
    let source: string | undefined;
    if (type === 'SONG') {
      item = await this.prisma.song.findUnique({
        where: { id },
        include: { artists: true, album: { include: { artist: true } } },
      });
      source = item?.audioUrl;
    } else if (type === 'VIDEO') {
      item = await this.prisma.video.findUnique({
        where: { id },
        include: { artists: true, mediaAsset: true },
      });
      source = item?.videoUrl;
      if (source?.startsWith('pyramidplay:video:')) source = item?.mediaAsset?.fileUrl;
    } else if (type === 'AUDIOBOOK') {
      item = await this.prisma.audiobook.findUnique({
        where: { id },
        include: { chapters: true },
      });
      source = item?.chapters?.find((c: any) => c.id === chapterId)?.audioUrl;
    } else if (type === 'COURSE') {
      item = await this.prisma.academicCourse.findUnique({
        where: { id },
        include: { modules: { include: { lessons: true } } },
      });
      const lesson = item?.modules
        .flatMap((m: any) => m.lessons)
        .find((l: any) => l.id === chapterId);
      if (!lesson) throw new NotFoundException('Leçon introuvable');
      source = lesson.contentUrl;
      if (item.isPublished && lesson.isFreePreview)
        item = { ...item, isMonetized: false };
    } else if (type === 'ASSET') {
      item = await this.prisma.mediaAsset.findUnique({ where: { id } });
      source = item?.fileUrl;
      if (
        !caller?.id ||
        (item?.userId !== caller.id && !(await this.isAdmin(caller)))
      )
        throw new ForbiddenException('Média privé');
    } else throw new NotFoundException('Type de contenu inconnu');
    if (!item || !source || source.startsWith('pyramidplay:'))
      throw new NotFoundException('Source indisponible');
    if (!(await this.canAccess(type, item, caller)))
      throw new ForbiddenException('Achetez ce contenu pour y accéder');
    return source;
  }

  async playback(
    type: string,
    id: string,
    caller?: ContentCaller,
    chapterId?: string,
  ) {
    const source = await this.source(type, id, caller, chapterId);
    const expiresAt = Math.floor(Date.now() / 1000) + 7200;
    const payload: Ticket = {
      type,
      contentId: id,
      chapterId,
      userId: caller?.id,
      expiresAt,
    };
    return {
      url: this.ticketUrl(payload),
      expiresAt,
      format: source.split('?')[0].endsWith('.m3u8') ? 'hls' : 'file',
    };
  }

  ticketUrl(payload: Ticket, source?: string) {
    const encoded = Buffer.from(
      JSON.stringify({ ...payload, ...(source ? { source } : {}) }),
    ).toString('base64url');
    const signature = createHmac('sha256', this.secret)
      .update(encoded)
      .digest('base64url');
    return `/content-access/stream?ticket=${encoded}.${signature}`;
  }

  verifyTicket(ticket: string): Ticket {
    if (typeof ticket !== 'string' || ticket.length > 12000)
      throw new UnauthorizedException('Lien invalide');
    const [encoded, signature, extra] = ticket.split('.');
    const expected = createHmac('sha256', this.secret)
      .update(encoded || '')
      .digest();
    const received = Buffer.from(signature || '', 'base64url');
    if (
      extra ||
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    )
      throw new UnauthorizedException('Lien invalide');
    let data: Ticket;
    try {
      data = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    } catch {
      throw new UnauthorizedException('Lien invalide');
    }
    if (
      !data.contentId ||
      !Number.isSafeInteger(data.expiresAt) ||
      data.expiresAt <= Date.now() / 1000
    )
      throw new UnauthorizedException('Lien expiré');
    return data;
  }

  segmentSource(root: string, segment: string) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new ForbiddenException('Segment invalide');
    }
    if (
      !decoded ||
      /^(?:[a-z]+:|\/|\\)/i.test(decoded) ||
      decoded.split(/[\\/]/).includes('..') ||
      decoded.includes('\0')
    )
      throw new ForbiddenException('Segment invalide');
    const rootUrl = new URL(root, 'http://local.invalid');
    const directory = rootUrl.pathname.slice(
      0,
      rootUrl.pathname.lastIndexOf('/') + 1,
    );
    const resolved = new URL(decoded, rootUrl);
    if (
      resolved.origin !== rootUrl.origin ||
      !resolved.pathname.startsWith(directory)
    )
      throw new ForbiddenException('Segment invalide');
    return root.startsWith('/') ? resolved.pathname : resolved.toString();
  }

  async sanitize(
    data: any,
    caller?: ContentCaller,
    baseUrl = '',
  ): Promise<any> {
    if (
      !data ||
      typeof data !== 'object' ||
      data instanceof Date ||
      Buffer.isBuffer(data)
    )
      return data;
    if (Array.isArray(data))
      return Promise.all(
        data.map((item) => this.sanitize(item, caller, baseUrl)),
      );
    if (
      Object.getPrototypeOf(data) !== Object.prototype &&
      Object.getPrototypeOf(data) !== null
    )
      return data;
    const result: any = { ...data };
    const previewUrl = (type: string, id: string, chapterId?: string) =>
      baseUrl +
      this.ticketUrl({
        type,
        contentId: id,
        chapterId,
        userId: caller?.id,
        expiresAt: Math.floor(Date.now() / 1000) + 7200,
      });
    if (data.id && typeof data.audioUrl === 'string' && !data.audiobookId) {
      result.audioUrl = `pyramidplay:audio:SONG:${data.id}`;
      if (await this.canManage(data, caller)) {
        result.editSourceUrl = data.audioUrl;
        result.previewUrl = previewUrl('SONG', data.id);
      }
    }
    if (data.id && typeof data.videoUrl === 'string') {
      result.videoUrl = `pyramidplay:video:${data.id}`;
      if (await this.canManage(data, caller)) {
        result.editSourceUrl = data.videoUrl;
        result.previewUrl = previewUrl(
          data.mediaAssetId ? 'ASSET' : 'VIDEO',
          data.mediaAssetId || data.id,
        );
      }
      for (const key of [
        'originalUrl',
        'hlsUrl',
        'mp4Url',
        'sources',
        'variants',
        'qualities',
      ])
        if (key in result) delete result[key];
      if (result.mediaAsset) delete result.mediaAsset;
    }
    if (data.id && Array.isArray(data.chapters)) {
      const allowed = await this.canAccess('AUDIOBOOK', data, caller);
      const manager = await this.canManage(data, caller);
      result.hasAccess = allowed;
      result.chapters = data.chapters.map((chapter: any) => ({
        ...chapter,
        audioUrl: chapter.audioUrl
          ? `pyramidplay:audio:AUDIOBOOK:${data.id}:${chapter.id}`
          : null,
        ...(manager && chapter.audioUrl
          ? {
              editSourceUrl: chapter.audioUrl,
              previewUrl: previewUrl('AUDIOBOOK', data.id, chapter.id),
            }
          : {}),
        ...(!allowed ? { text: null, timestamps: null, locked: true } : {}),
      }));
    }
    // Raw chapter responses are also protected; they may come from authoring routes.
    if (data.audiobookId && data.id) {
      const book = await this.prisma.audiobook.findUnique({
        where: { id: data.audiobookId },
      });
      const allowed = await this.canAccess('AUDIOBOOK', book, caller);
      if (result.audioUrl)
        result.audioUrl = `pyramidplay:audio:AUDIOBOOK:${data.audiobookId}:${data.id}`;
      if (!allowed) {
        result.text = null;
        result.timestamps = null;
      }
    }
    if (
      data.id &&
      typeof data.fileUrl === 'string' &&
      ['audio', 'video'].includes(data.type)
    ) {
      result.sourceRef = `pyramidplay:asset:${data.id}`;
      result.fileUrl =
        caller?.id &&
        (data.userId === caller.id || (await this.isAdmin(caller)))
          ? baseUrl + (await this.playback('ASSET', data.id, caller)).url
          : null;
      delete result.originalObject;
      delete result.originalBucket;
    }
    if (data.id && Array.isArray(data.modules)) {
      result.modules = await Promise.all(
        data.modules.map(async (module: any) => ({
          ...module,
          lessons: await Promise.all(
            (module.lessons || []).map(async (lesson: any) => {
              if (
                !lesson.contentUrl ||
                !['AUDIO', 'VIDEO'].includes(lesson.contentType)
              )
                return lesson;
              const ticket = await this.playback(
                'COURSE',
                data.id,
                caller,
                lesson.id,
              );
              return {
                ...lesson,
                contentUrl: baseUrl + ticket.url,
                contentFormat: ticket.format,
              };
            }),
          ),
        })),
      );
    }
    for (const [key, value] of Object.entries(result)) {
      if (key === 'chapters' && Array.isArray(data.chapters)) continue;
      if (key === 'modules' && Array.isArray(data.modules)) continue;
      if (value && typeof value === 'object')
        result[key] = await this.sanitize(value, caller, baseUrl);
    }
    return result;
  }
}
