import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AcademicSubscriptionService } from './academic-subscription.service';

@Injectable()
export class MediaSourceOwnershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: AcademicSubscriptionService,
  ) {}

  isAdmin(userId: string) {
    return this.subscriptions.isAdmin(userId);
  }

  private canonical(source: string): string | null {
    let url: URL;
    try {
      url = new URL(source, 'http://local.invalid');
    } catch {
      throw new ForbiddenException('Source invalide');
    }
    const internalHosts = new Set([
      'local.invalid',
      'localhost',
      '127.0.0.1',
      'media.pyramidplay.cm',
    ]);
    for (const value of [
      process.env.MINIO_PUBLIC_URL,
      process.env.MINIO_ENDPOINT,
    ]) {
      try {
        if (value)
          internalHosts.add(
            new URL(value.includes('://') ? value : `http://${value}`).hostname,
          );
      } catch {}
    }
    const blob = url.hostname.endsWith('.blob.vercel-storage.com');
    if (!blob && !internalHosts.has(url.hostname)) return null;
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      throw new ForbiddenException('Source invalide');
    }
    if (path.includes('\\') || path.includes('\0'))
      throw new ForbiddenException('Source invalide');
    return `${blob ? url.hostname : 'internal'}:${path}`;
  }

  async resolve(
    source: unknown,
    userId: string,
    existingSource?: string | null,
  ): Promise<any> {
    if (source == null || source === '') return source;
    if (typeof source !== 'string')
      throw new ForbiddenException('Source invalide');
    const admin = await this.subscriptions.isAdmin(userId);
    let assetId: string | undefined;
    if (source.startsWith('pyramidplay:asset:'))
      assetId = source.slice('pyramidplay:asset:'.length);
    else {
      let url: URL;
      try {
        url = new URL(source, 'http://local.invalid');
      } catch {
        throw new ForbiddenException('Source invalide');
      }
      if (/\/content-access\/stream\/?$/i.test(url.pathname)) {
        try {
          const ticket = url.searchParams.get('ticket') || '';
          if (ticket.length > 12000) throw new Error();
          const payload = JSON.parse(
            Buffer.from(ticket.split('.')[0], 'base64url').toString(),
          );
          if (
            payload.type !== 'ASSET' ||
            typeof payload.contentId !== 'string' ||
            !payload.contentId
          )
            throw new Error();
          assetId = payload.contentId;
        } catch {
          throw new ForbiddenException(
            'Choisissez un média de votre bibliothèque',
          );
        }
      }
    }
    if (assetId) {
      const asset = await this.prisma.mediaAsset.findUnique({
        where: { id: assetId },
      });
      if (!asset || (!admin && asset.userId !== userId))
        throw new ForbiddenException('Ce média appartient à un autre compte');
      return asset.fileUrl;
    }
    if (source.startsWith('pyramidplay:'))
      throw new ForbiddenException('Référence de média invalide');
    const canonical = this.canonical(source);
    if (!canonical) return source; // External public providers are not served with storage credentials.
    if (existingSource && this.canonical(existingSource) === canonical)
      return existingSource;
    if (admin) return source;
    const assets = await this.prisma.mediaAsset.findMany({
      where: { userId },
      select: { fileUrl: true },
    });
    const asset = assets.find(
      (entry) => this.canonical(entry.fileUrl) === canonical,
    );
    if (!asset)
      throw new ForbiddenException(
        'Choisissez un média importé dans votre bibliothèque',
      );
    return asset.fileUrl;
  }
}
