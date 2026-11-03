import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { createReadStream, existsSync, statSync } from 'fs';
import { resolve, sep } from 'path';
import { Readable } from 'stream';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { MinioService } from '../storage/minio.service';
import { ContentAccessService } from './content-access.service';
import { videoByteRange } from '../files/video-byte-range';

@Controller('content-access')
export class ContentAccessController {
  constructor(
    private readonly access: ContentAccessService,
    private readonly minio: MinioService,
  ) {}

  @Get('playback/:type/:id')
  @UseGuards(OptionalJwtAuthGuard)
  playback(
    @Param('type') type: string,
    @Param('id') id: string,
    @Query('chapterId') chapterId: string,
    @Req() req: any,
  ) {
    return this.access.playback(type, id, req.user, chapterId);
  }

  @Get('stream')
  async stream(
    @Query('ticket') ticket: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    const payload = this.access.verifyTicket(ticket);
    // Check persisted rights again: even a valid ticket cannot resurrect revoked rights.
    const root = await this.access.source(
      payload.type,
      payload.contentId,
      { id: payload.userId },
      payload.chapterId,
    );
    const source = payload.source || root;
    const path = new URL(source, 'http://local.invalid').pathname;
    const isHls = path.endsWith('.m3u8');
    res.setHeader('Cache-Control', 'private, no-store');
    let stream: any;
    let size: number | undefined;
    let mime = path.endsWith('.ts')
      ? 'video/mp2t'
      : path.endsWith('.mp4')
        ? 'video/mp4'
        : path.endsWith('.webm')
          ? 'video/webm'
          : path.endsWith('.mov')
            ? 'video/quicktime'
        : path.endsWith('.m4a')
          ? 'audio/mp4'
          : 'audio/mpeg';
    if (source.startsWith('/uploads/')) {
      const base = resolve(process.cwd(), 'uploads');
      const file = resolve(
        base,
        decodeURIComponent(path.slice('/uploads/'.length)),
      );
      if (!file.startsWith(base + sep) || !existsSync(file))
        throw new NotFoundException('Fichier introuvable');
      size = statSync(file).size;
      const range = videoByteRange(req.headers.range, size);
      if (range === 'unsatisfiable')
        return res.status(416).set('Content-Range', `bytes */${size}`).end();
      if (range && !isHls) {
        res
          .status(206)
          .set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
          .set('Content-Length', String(range.end - range.start + 1));
        stream = createReadStream(file, { start: range.start, end: range.end });
      } else {
        stream = createReadStream(file);
        if (!isHls) res.set('Content-Length', String(size));
      }
    } else {
      const url = new URL(source);
      const trustedHosts = ['localhost', '127.0.0.1', 'media.pyramidplay.cm'];
      for (const candidate of [
        process.env.MINIO_PUBLIC_URL,
        process.env.MINIO_ENDPOINT
          ? `${process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http'}://${process.env.MINIO_ENDPOINT}`
          : undefined,
      ]) {
        try {
          if (candidate) trustedHosts.push(new URL(candidate).hostname);
        } catch {}
      }
      const isBlob = url.hostname.endsWith('.private.blob.vercel-storage.com');
      const minioPath = /^\/([^/]+)\/(.+)$/.exec(
        decodeURIComponent(url.pathname),
      );
      if (trustedHosts.includes(url.hostname) && minioPath) {
        const bucket = minioPath[1],
          object = minioPath[2];
        const full = await this.minio.getObjectStream(bucket, object);
        size = full.stat?.size;
        mime = full.stat?.metaData?.['content-type'] || mime;
        const range =
          typeof size === 'number' && !isHls
            ? videoByteRange(req.headers.range, size)
            : undefined;
        if (range === 'unsatisfiable') {
          full.stream.destroy();
          return res.status(416).set('Content-Range', `bytes */${size}`).end();
        }
        if (range) {
          full.stream.destroy();
          stream = (
            await this.minio.getObjectStream(bucket, object, {
              offset: range.start,
              length: range.end - range.start + 1,
            })
          ).stream;
          res
            .status(206)
            .set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
            .set('Content-Length', String(range.end - range.start + 1));
        } else {
          stream = full.stream;
          if (!isHls && size !== undefined)
            res.set('Content-Length', String(size));
        }
      } else if (isBlob && process.env.BLOB_READ_WRITE_TOKEN) {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
        };
        if (req.headers.range && !isHls) headers.Range = req.headers.range;
        const response = await fetch(url, {
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok || !response.body)
          throw new NotFoundException('Média indisponible');
        res.status(response.status);
        for (const header of [
          'content-type',
          'content-length',
          'content-range',
        ])
          if (response.headers.has(header) && !isHls)
            res.setHeader(header, response.headers.get(header));
        stream = Readable.fromWeb(response.body as any);
      } else {
        throw new ForbiddenException(
          'Réimportez ce média dans le stockage privé pour permettre sa lecture protégée',
        );
      }
    }
    if (isHls) {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const playlist = Buffer.concat(chunks).toString('utf8');
      const segmentUrl = (segment: string) => {
        const next = this.access.segmentSource(source, segment);
        // Relative paths work behind localhost as well as Ngrok.
        return this.access.ticketUrl(payload, next);
      };
      const rewritten = playlist
        .split('\n')
        .map((line) => {
          if (!line.trim()) return line;
          if (line.startsWith('#'))
            return line.replace(
              /URI="([^"]+)"/g,
              (_match, uri) => `URI="${segmentUrl(uri)}"`,
            );
          return segmentUrl(line.trim());
        })
        .join('\n');
      return res.type('application/vnd.apple.mpegurl').send(rewritten);
    }
    res.setHeader('Accept-Ranges', 'bytes');
    if (!res.hasHeader('Content-Type')) res.type(mime);
    stream.on('error', () => {
      if (!res.headersSent) res.status(502).end();
      else res.destroy();
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
}
