import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ContentAccessService } from './content-access.service';
import { isMediaStorageUrl } from './media-storage-url';

/** Legacy URLs may play public content; a guessed storage path never grants access. */
@Injectable()
export class LegacyMediaGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly access: ContentAccessService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const url = req.query.url;
    if (typeof url !== 'string' || url.length > 4096 || !isMediaStorageUrl(url)) throw new ForbiddenException('Source invalide');
    const video = req.path.endsWith('resolved-video');
    if (video) {
      const item = await this.prisma.video.findFirst({ where: { videoUrl: url }, include: { artists: true } });
      if (await this.access.canAccess('VIDEO', item, req.user)) return true;
    } else {
      const song = await this.prisma.song.findFirst({ where: { audioUrl: url }, include: { artists: true, album: true } });
      if (song && await this.access.canAccess('SONG', song, req.user)) return true;
      const chapter = await this.prisma.audiobookChapter.findFirst({ where: { audioUrl: url }, include: { audiobook: true } });
      if (chapter && await this.access.canAccess('AUDIOBOOK', chapter.audiobook, req.user)) return true;
    }
    // Creator previews of newly uploaded media require their authenticated account.
    if (req.user?.id) {
      const asset = await this.prisma.mediaAsset.findFirst({ where: { fileUrl: url, userId: req.user.id } });
      if (asset) return true;
    }
    throw new ForbiddenException('Demandez un accès de lecture pour ce contenu');
  }
}
