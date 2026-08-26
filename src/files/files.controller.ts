/* eslint-disable no-empty */
import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';
import { extname, join } from 'path';
import { randomBytes } from 'crypto';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { MinioService } from '../storage/minio.service';
import { VercelBlobService } from '../storage/vercel-blob.service';
import { HlsTranscoderService } from '../storage/hls-transcoder.service';
import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, rmSync } from 'fs';
import { Readable } from 'stream';

async function streamToString(stream: any): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on('error', (err: any) => reject(err));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

function ensureDir(path: string) {
  try {
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
  } catch (e) {
    console.warn(
      `[FilesController] Could not ensure directory ${path}: ${e.message}`,
    );
  }
}

function diskAudioStorage() {
  return diskStorage({
    destination: (_req, _file, cb) => {
      const dest = join(process.cwd(), 'uploads', 'audio');
      ensureDir(dest);
      cb(null, dest);
    },
    filename: (_req, file, cb) => {
      const unique = randomBytes(8).toString('hex');
      cb(null, `${Date.now()}-${unique}${extname(file.originalname)}`);
    },
  });
}

function diskVideoStorage() {
  return diskStorage({
    destination: (_req, _file, cb) => {
      const dest = join(process.cwd(), 'uploads', 'videos');
      ensureDir(dest);
      cb(null, dest);
    },
    filename: (_req, file, cb) => {
      const unique = randomBytes(8).toString('hex');
      cb(null, `${Date.now()}-${unique}${extname(file.originalname)}`);
    },
  });
}

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(
    private readonly minio: MinioService,
    private readonly blob: VercelBlobService,
    private readonly hlsTranscoder: HlsTranscoderService,
  ) { }

  @Get('resolved-image')
  async resolvedImage(
    @Query('url') url: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    if (!url) {
      res.status(400).send('Missing url');
      return;
    }
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

      // 1. Direct S3 streaming via MinIO client
      if (this.minio.isEnabled()) {
        const match = url.match(/\/(images|play-images)\/([^?]+)(\?.*)?$/);
        if (match && match[2]) {
          const bucket = match[1];
          const objectName = match[2];
          try {
            const { stream, stat } = await this.minio.getObjectStream(bucket, objectName);
            if (stat?.metaData?.['content-type'] || stat?.contentType) {
              res.setHeader('Content-Type', stat.metaData?.['content-type'] || stat.contentType);
            } else if (objectName.endsWith('.png')) {
              res.setHeader('Content-Type', 'image/png');
            } else if (objectName.endsWith('.webp')) {
              res.setHeader('Content-Type', 'image/webp');
            } else {
              res.setHeader('Content-Type', 'image/jpeg');
            }
            if (stat?.size) {
              res.setHeader('Content-Length', stat.size);
            }
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.status(200);
            stream.pipe(res);
            return;
          } catch (err) {
            console.warn('[resolvedImage] MinIO getObjectStream failed, trying HTTP fetch:', err.message);
          }
        }
      }

      // 1.5. Local disk check for /uploads/ files
      if (url.includes('/uploads/')) {
        const relativePath = url.substring(url.indexOf('/uploads/'));
        const diskPath = join(process.cwd(), relativePath);
        if (existsSync(diskPath)) {
          if (diskPath.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
          else if (diskPath.endsWith('.webp')) res.setHeader('Content-Type', 'image/webp');
          else res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.status(200);
          createReadStream(diskPath).pipe(res);
          return;
        }
      }

      // 2. HTTP fetch fallback
      let target = url;
      if (!target.startsWith('http://') && !target.startsWith('https://')) {
        const publicUrl = process.env.MINIO_PUBLIC_URL || 'http://localhost:9000';
        target = `${publicUrl.replace(/\/+$/, '')}/${target.replace(/^\/+/, '')}`;
      }

      const headers: Record<string, string> = {};
      const range = req?.headers?.range;
      if (typeof range === 'string' && range.length > 0) {
        headers.Range = range;
      }

      const upstream = await fetch(target, { headers }).catch(() => null);

      if (!upstream || upstream.status === 404) {
        const pixel = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+Xh8cAAAAASUVORK5CYII=',
          'base64',
        );
        res.status(200);
        res.setHeader('content-type', 'image/png');
        res.setHeader('content-length', String(pixel.length));
        res.end(pixel);
        return;
      }

      res.status(upstream.status);
      const passHeaders = [
        'content-type',
        'content-length',
        'accept-ranges',
        'content-range',
        'etag',
        'last-modified',
        'cache-control',
      ];
      for (const h of passHeaders) {
        const v = upstream.headers.get(h);
        if (v) res.setHeader(h, v);
      }

      if (!upstream.body) {
        res.end();
        return;
      }

      Readable.fromWeb(upstream.body as any).pipe(res);
    } catch (err) {
      console.error('[resolvedImage] Critical error:', err.message);
      res.status(500).send(`Failed to resolve image: ${err.message}`);
    }
  }

  @Post('upload-audio')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 1024 * 1024 * 500 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  async uploadAudio(@UploadedFile() file?: Express.Multer.File) {
    if (!file) return { error: 'No file' };

    const uniqueName = `${Date.now()}-${randomBytes(6).toString('hex')}${extname(file.originalname)}`;
    const isProduction =
      process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

    const fileBuffer = file.buffer || ((file as any).path ? readFileSync((file as any).path) : null);

    // 1. En PRODUCTION : Priorité à Vercel Blob s'il est activé
    if (isProduction && this.blob.isEnabled() && fileBuffer) {
      try {
        const objectName = `audio/${uniqueName}`;
        console.log(
          `[FilesController] Production: Uploading audio to Vercel Blob: ${objectName}`,
        );
        const url = await this.blob.upload({
          objectName,
          buffer: fileBuffer,
          contentType: file.mimetype,
        });
        return { url };
      } catch (err) {
        console.error(
          `[FilesController] Vercel Blob upload failed: ${err.message}`,
        );
      }
    }

    // 2. En LOCAL (ou MinIO sur VPS)
    if (this.minio.isEnabled() && fileBuffer) {
      try {
        const env = isProduction ? 'Production Fallback' : 'Local';
        console.log(
          `[FilesController] ${env}: Uploading audio to MinIO: ${uniqueName}`,
        );
        const url = await this.minio.upload({
          bucket: 'audio',
          objectName: uniqueName,
          buffer: fileBuffer,
          contentType: file.mimetype || 'audio/mpeg',
        });
        if ((file as any)?.path && existsSync((file as any).path)) {
          try { rmSync((file as any).path); } catch {}
        }
        return { url: typeof url === 'string' ? url : (url as any).url || url };
      } catch (err) {
        if ((file as any)?.path && existsSync((file as any).path)) {
          try { rmSync((file as any).path); } catch {}
        }
        console.error(`[FilesController] MinIO audio upload failed: ${err.message}`);
        throw new BadRequestException(`Échec de l'upload audio vers MinIO: ${err.message}`);
      }
    }

    throw new BadRequestException('MinIO storage service is not enabled or file buffer missing');
  }

  @Post('upload-image')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  async uploadImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) return { error: 'No file' };

    const uniqueName = `${Date.now()}-${randomBytes(6).toString('hex')}${extname(file.originalname)}`;
    const isProduction =
      process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

    // 1. En PRODUCTION : Priorité absolue à Vercel Blob
    if (isProduction && this.blob.isEnabled()) {
      try {
        const objectName = `images/${uniqueName}`;
        console.log(
          `[FilesController] Production: Uploading image to Vercel Blob: ${objectName}`,
        );
        const url = await this.blob.upload({
          objectName,
          buffer: file.buffer,
          contentType: file.mimetype,
        });
        return { url };
      } catch (err) {
        console.error(
          `[FilesController] Vercel Blob Image upload failed: ${err.message}`,
        );
      }
    }

    // 2. Utilisation de MinIO
    if (this.minio.isEnabled()) {
      try {
        const env = isProduction ? 'Production Fallback' : 'Local';
        console.log(
          `[FilesController] ${env}: Uploading image to MinIO: ${uniqueName}`,
        );
        const url = await this.minio.upload({
          bucket: 'images',
          objectName: uniqueName,
          buffer: file.buffer,
          contentType: file.mimetype,
        });
        return { url: typeof url === 'string' ? url : (url as any).url || url };
      } catch (err) {
        console.error(
          `[FilesController] MinIO Image upload failed: ${err.message}`,
        );
        throw new BadRequestException(`Échec de l'upload d'image vers MinIO: ${err.message}`);
      }
    }

    throw new BadRequestException('MinIO storage service is not enabled');
  }

  @Post('analyze-video')
  @UseInterceptors(FileInterceptor('file', { storage: diskVideoStorage() }))
  async analyzeVideo(
    @UploadedFile() file?: Express.Multer.File,
    @Req() req?: any,
  ) {
    let targetPath = file?.path;
    let cleanupNeeded = false;

    if (!targetPath && req?.body?.url) {
      const url = req.body.url;
      if (url.includes('/uploads/')) {
        const relativePath = url.substring(url.indexOf('/uploads/'));
        const diskPath = join(process.cwd(), relativePath);
        if (existsSync(diskPath)) targetPath = diskPath;
      }
      if (!targetPath) {
        // Download into temp file for probing
        try {
          const tempName = `probe-${Date.now()}-${randomBytes(4).toString('hex')}.mp4`;
          const tempPath = join(process.cwd(), 'uploads', 'videos', tempName);
          ensureDir(join(process.cwd(), 'uploads', 'videos'));
          const upstream = await fetch(url);
          if (upstream.ok) {
            const buf = Buffer.from(await upstream.arrayBuffer());
            writeFileSync(tempPath, buf);
            targetPath = tempPath;
            cleanupNeeded = true;
          }
        } catch (e: any) {
          console.warn('[analyzeVideo] Could not fetch remote URL:', e.message);
        }
      }
    }

    if (!targetPath || !existsSync(targetPath)) {
      return {
        width: 1280,
        height: 720,
        duration: 0,
        formattedDuration: '00:00',
        maxQuality: '720p',
        maxQualityLabel: '720P',
        allowedQualities: ['720p', '480p', '360p'],
      };
    }

    try {
      const result = await this.hlsTranscoder.analyzeVideo(targetPath);
      return result;
    } finally {
      if (cleanupNeeded && targetPath && existsSync(targetPath)) {
        try { rmSync(targetPath); } catch {}
      }
    }
  }

  @Post('generate-video-variants')
  @UseInterceptors(FileInterceptor('file', { storage: diskVideoStorage() }))
  async generateVideoVariants(
    @UploadedFile() file?: Express.Multer.File,
    @Req() req?: any,
  ) {
    let targetPath = file?.path;
    let cleanupNeeded = false;

    if (!targetPath && req?.body?.url) {
      const url = req.body.url;
      if (url.includes('/uploads/')) {
        const relativePath = url.substring(url.indexOf('/uploads/'));
        const diskPath = join(process.cwd(), relativePath);
        if (existsSync(diskPath)) targetPath = diskPath;
      }
      if (!targetPath) {
        try {
          const tempName = `transcode-${Date.now()}-${randomBytes(4).toString('hex')}.mp4`;
          const tempPath = join(process.cwd(), 'uploads', 'videos', tempName);
          ensureDir(join(process.cwd(), 'uploads', 'videos'));
          const upstream = await fetch(url);
          if (upstream.ok) {
            const buf = Buffer.from(await upstream.arrayBuffer());
            writeFileSync(tempPath, buf);
            targetPath = tempPath;
            cleanupNeeded = true;
          }
        } catch (e: any) {
          console.warn('[generateVideoVariants] Could not fetch remote URL:', e.message);
        }
      }
    }

    if (!targetPath || !existsSync(targetPath)) {
      throw new BadRequestException('Aucun fichier vidéo source disponible pour le transcodage');
    }

    try {
      const targetQualities = req?.body?.targetQualities
        ? (Array.isArray(req.body.targetQualities) ? req.body.targetQualities : JSON.parse(req.body.targetQualities))
        : undefined;

      const result = await this.hlsTranscoder.generateVideoVariants({
        inputPath: targetPath,
        mediaId: req?.body?.mediaId,
        targetQualities,
      });

      return result;
    } finally {
      if (cleanupNeeded && targetPath && existsSync(targetPath)) {
        try { rmSync(targetPath); } catch {}
      }
    }
  }

  @Post('upload-video')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskVideoStorage(),
      limits: { fileSize: 1024 * 1024 * 500 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  async uploadVideo(@UploadedFile() file?: Express.Multer.File) {
    if (!file) return { error: 'No file' };

    const uniqueName = file.filename || `${Date.now()}-${randomBytes(6).toString('hex')}${extname(file.originalname)}`;
    const isProduction =
      process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

    const fileBuffer = file.buffer || (file.path ? readFileSync(file.path) : null);

    if (!fileBuffer && !file.path) {
      console.error('[FilesController] Error: fileBuffer is null or undefined for video upload');
      return { error: 'No video file buffer available' };
    }

    // Probing source video metadata
    let analysis: any = null;
    if (file.path && existsSync(file.path)) {
      analysis = await this.hlsTranscoder.analyzeVideo(file.path);
    }

    if (isProduction && this.blob.isEnabled() && fileBuffer) {
      try {
        const objectName = `videos/${uniqueName}`;
        const url = await this.blob.upload({
          objectName,
          buffer: fileBuffer,
          contentType: file.mimetype,
        });
        return { url, rawUrl: url, analysis };
      } catch (err) {
        console.error(
          `[FilesController] Vercel Blob video upload failed: ${err.message}`,
        );
      }
    }

    if (this.minio.isEnabled() && fileBuffer) {
      try {
        console.log(`[FilesController] Uploading video to MinIO: ${uniqueName}`);
        const url = await this.minio.upload({
          bucket: 'videos',
          objectName: uniqueName,
          buffer: fileBuffer,
          contentType: file.mimetype || 'video/mp4',
        });
        const finalUrl = typeof url === 'string' ? url : (url as any).url || url;
        if (file.path && existsSync(file.path)) {
          try { rmSync(file.path); } catch {}
        }
        return { url: finalUrl, rawUrl: finalUrl, analysis };
      } catch (err) {
        if (file.path && existsSync(file.path)) {
          try { rmSync(file.path); } catch {}
        }
        console.error(`[FilesController] MinIO video upload failed: ${err.message}`);
        throw new BadRequestException(`Échec de l'upload vidéo vers MinIO: ${err.message}`);
      }
    }

    throw new BadRequestException('MinIO storage service is not enabled');
  }

  @Get('resolved-audio')
  async resolvedAudio(@Query('url') url: string, @Req() req: any, @Res() res: any) {
    if (!url) {
      res.status(400).send('Missing url');
      return;
    }
    console.log(`[resolvedAudio] Incoming request for url="${url}"`);
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization');

      // 1. Direct S3 streaming via MinIO client
      if (this.minio.isEnabled()) {
        const match = url.match(/\/(audio|play-audio)\/([^?]+)(\?.*)?$/);
        console.log(`[resolvedAudio] MinIO enabled. Regex match:`, match ? { bucket: match[1], objectName: match[2] } : 'NO MATCH');
        if (match && match[2]) {
          const bucket = match[1];
          const objectName = match[2];
          try {
            const { stream, stat } = await this.minio.getObjectStream(bucket, objectName);
            console.log(`[resolvedAudio] ✓ getObjectStream succeeded for bucket="${bucket}", object="${objectName}"`);
            if (objectName.endsWith('.m3u8')) {
              const text = await streamToString(stream);
              const baseDirUrl = url.substring(0, url.lastIndexOf('/') + 1);
              const reqProtocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
              const reqHost = req.headers['x-forwarded-host'] || req.get('host') || 'api.pyramidplay.cm';
              const selfBase = `${reqProtocol}://${reqHost}/files/resolved-audio?url=`;

              const rewritten = text
                .split('\n')
                .map((line) => {
                  const trimmed = line.trim();
                  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                    return line;
                  }
                  return `${selfBase}${encodeURIComponent(baseDirUrl + trimmed)}`;
                })
                .join('\n');

              res.setHeader('Content-Type', 'application/x-mpegURL');
              res.setHeader('Cache-Control', 'no-cache');
              res.status(200).send(rewritten);
              return;
            }

            if (stat?.metaData?.['content-type'] || stat?.contentType) {
              res.setHeader('Content-Type', stat.metaData?.['content-type'] || stat.contentType);
            } else if (objectName.endsWith('.ts')) {
              res.setHeader('Content-Type', 'video/mp2t');
            } else if (objectName.endsWith('.mp3')) {
              res.setHeader('Content-Type', 'audio/mpeg');
            }
            if (stat?.size) {
              res.setHeader('Content-Length', stat.size);
            }
            res.setHeader('Accept-Ranges', 'bytes');
            res.status(200);
            stream.pipe(res);
            return;
          } catch (err) {
            console.warn(`[resolvedAudio] MinIO getObjectStream FAILED for bucket="${bucket}", object="${objectName}":`, err.code || err.message);
          }
        }
      } else {
        console.log('[resolvedAudio] MinIO is NOT enabled');
      }

      // 2. Local disk check for /uploads/ files
      if (url.includes('/uploads/')) {
        const relativePath = url.substring(url.indexOf('/uploads/'));
        const diskPath = join(process.cwd(), relativePath);
        if (existsSync(diskPath)) {
          if (diskPath.endsWith('.mp3')) res.setHeader('Content-Type', 'audio/mpeg');
          else if (diskPath.endsWith('.m3u8')) res.setHeader('Content-Type', 'application/x-mpegURL');
          else if (diskPath.endsWith('.ts')) res.setHeader('Content-Type', 'video/mp2t');
          res.setHeader('Accept-Ranges', 'bytes');
          res.status(200);
          createReadStream(diskPath).pipe(res);
          return;
        }
      }

      // 3. HTTP fetch fallback
      let target = url;
      if (!target.startsWith('http://') && !target.startsWith('https://')) {
        const publicUrl = process.env.MINIO_PUBLIC_URL || 'http://localhost:9000';
        target = `${publicUrl.replace(/\/+$/, '')}/${target.replace(/^\/+/, '')}`;
      }

      const headers: Record<string, string> = {};
      const range = req?.headers?.range;
      if (typeof range === 'string' && range.length > 0) {
        headers.Range = range;
      }

      const upstream = await fetch(target, { headers }).catch((err) => {
        console.log('[resolvedAudio] Direct fetch failed:', err.message);
        return null;
      });

      if (!upstream || !upstream.ok) {
        res.status(upstream ? upstream.status : 404).send('Audio stream not found');
        return;
      }

      res.status(upstream.status);
      const passHeaders = [
        'content-type',
        'content-length',
        'accept-ranges',
        'content-range',
        'etag',
        'last-modified',
        'cache-control',
      ];
      for (const h of passHeaders) {
        const v = upstream.headers.get(h);
        if (v) res.setHeader(h, v);
      }

      if (!upstream.body) {
        res.end();
        return;
      }

      Readable.fromWeb(upstream.body as any).pipe(res);
    } catch (err) {
      console.error('[resolvedAudio] Critical error:', err.message);
      res.status(500).send(`Failed to resolve audio: ${err.message}`);
    }
  }

  @Get('resolved-video')
  async resolvedVideo(@Query('url') url: string, @Req() req: any, @Res() res: any) {
    if (!url) {
      res.status(400).send('Missing url');
      return;
    }

    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization');

      // 1. Direct S3 streaming via MinIO client
      if (this.minio.isEnabled()) {
        const match = url.match(/\/(videos|play-videos)\/([^?]+)(\?.*)?$/);
        if (match && match[2]) {
          const bucket = match[1];
          const objectName = match[2];
          try {
            const { stream, stat } = await this.minio.getObjectStream(bucket, objectName);
            if (objectName.endsWith('.m3u8')) {
              const text = await streamToString(stream);
              const baseDirUrl = url.substring(0, url.lastIndexOf('/') + 1);
              const reqProtocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
              const reqHost = req.headers['x-forwarded-host'] || req.get('host') || 'api.pyramidplay.cm';
              const selfBase = `${reqProtocol}://${reqHost}/files/resolved-video?url=`;

              const rewritten = text
                .split('\n')
                .map((line) => {
                  const trimmed = line.trim();
                  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                    return line;
                  }
                  return `${selfBase}${encodeURIComponent(baseDirUrl + trimmed)}`;
                })
                .join('\n');

              res.setHeader('Content-Type', 'application/x-mpegURL');
              res.setHeader('Cache-Control', 'no-cache');
              res.status(200).send(rewritten);
              return;
            }

            if (stat?.metaData?.['content-type'] || stat?.contentType) {
              res.setHeader('Content-Type', stat.metaData?.['content-type'] || stat.contentType);
            } else if (objectName.endsWith('.ts')) {
              res.setHeader('Content-Type', 'video/mp2t');
            } else if (objectName.endsWith('.mp4')) {
              res.setHeader('Content-Type', 'video/mp4');
            }
            if (stat?.size) {
              res.setHeader('Content-Length', stat.size);
            }
            res.setHeader('Accept-Ranges', 'bytes');
            res.status(200);
            stream.pipe(res);
            return;
          } catch (err) {
            console.warn('[resolvedVideo] MinIO getObjectStream failed, trying HTTP fetch:', err.message);
          }
        }
      }

      // 1.5. Local disk check for /uploads/ files
      if (url.includes('/uploads/')) {
        const relativePath = url.substring(url.indexOf('/uploads/'));
        const diskPath = join(process.cwd(), relativePath);
        if (existsSync(diskPath)) {
          if (diskPath.endsWith('.ts')) res.setHeader('Content-Type', 'video/mp2t');
          else if (diskPath.endsWith('.mp4')) res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Accept-Ranges', 'bytes');
          res.status(200);
          createReadStream(diskPath).pipe(res);
          return;
        }
      }

      // 2. HTTP fetch fallback
      let target = url;
      if (!target.startsWith('http://') && !target.startsWith('https://')) {
        const publicUrl = process.env.MINIO_PUBLIC_URL || 'http://localhost:9000';
        target = `${publicUrl.replace(/\/+$/, '')}/${target.replace(/^\/+/, '')}`;
      }

      const headers: Record<string, string> = {};
      const range = req?.headers?.range;
      if (typeof range === 'string' && range.length > 0) {
        headers.Range = range;
      }

      const upstream = await fetch(target, { headers }).catch((err) => {
        console.log('[resolvedVideo] Direct fetch failed:', err.message);
        return null;
      });

      if (!upstream || !upstream.ok) {
        res.status(upstream ? upstream.status : 404).send('Video stream not found');
        return;
      }

      res.status(upstream.status);
      const passHeaders = [
        'content-type',
        'content-length',
        'accept-ranges',
        'content-range',
        'etag',
        'last-modified',
      ];
      for (const h of passHeaders) {
        const v = upstream.headers.get(h);
        if (v) res.setHeader(h, v);
      }

      if (!upstream.body) {
        res.end();
        return;
      }

      Readable.fromWeb(upstream.body as any).pipe(res);
    } catch (err) {
      console.error('[resolvedVideo] Critical error:', err.message);
      res.status(500).send(`Failed to resolve video: ${err.message}`);
    }
  }

  @Post('blob-token')
  async getBlobToken(@Query('pathname') pathname: string) {
    if (!this.blob.isEnabled()) {
      return { error: 'Vercel Blob is not enabled' };
    }
    const token = await this.blob.generateToken(pathname || 'uploads');
    return { token };
  }
}
