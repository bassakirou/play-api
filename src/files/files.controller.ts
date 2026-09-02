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
import { MediaService } from '../media/media.service';
import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, createWriteStream, rmSync } from 'fs';
import { Readable } from 'stream';

async function streamToString(stream: any): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on('error', (err: any) => reject(err));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

function getImageDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (!buffer || buffer.length < 24) return null;

  // 1. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  // 2. GIF: 'GIF87a' or 'GIF89a'
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46
  ) {
    return {
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8),
    };
  }

  // 3. WebP: 'RIFF' .... 'WEBP'
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    // VP8 lossy
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x20) {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }
    // VP8X extended
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x58) {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }
    // VP8L lossless
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x4c) {
      if (buffer[20] === 0x2f) {
        const b1 = buffer[21];
        const b2 = buffer[22];
        const b3 = buffer[23];
        const b4 = buffer[24];
        const width = 1 + (((b2 & 0x3f) << 8) | b1);
        const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
        return { width, height };
      }
    }
  }

  // 4. JPEG: 0xFF, 0xD8
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length - 8) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      if (offset + 3 < buffer.length) {
        const length = buffer.readUInt16BE(offset + 2);
        offset += 2 + length;
      } else {
        break;
      }
    }
  }

  return null;
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
    private readonly mediaService: MediaService,
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
            if (stat?.etag) {
              res.setHeader('ETag', stat.etag);
              if (req.headers['if-none-match'] === stat.etag) {
                res.status(304).end();
                return;
              }
            }
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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
  async uploadAudio(@UploadedFile() file?: Express.Multer.File, @Req() req?: any) {
    if (!file) return { error: 'No file' };

    const uniqueName = `${Date.now()}-${randomBytes(6).toString('hex')}${extname(file.originalname)}`;
    const isProduction =
      process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

    const fileBuffer = file.buffer || ((file as any).path ? readFileSync((file as any).path) : null);
    let finalUrl = '';

    // 1. En PRODUCTION : Priorité à Vercel Blob s'il est activé
    if (isProduction && this.blob.isEnabled() && fileBuffer) {
      try {
        const objectName = `audio/${uniqueName}`;
        console.log(
          `[FilesController] Production: Uploading audio to Vercel Blob: ${objectName}`,
        );
        finalUrl = await this.blob.upload({
          objectName,
          buffer: fileBuffer,
          contentType: file.mimetype,
        });
      } catch (err) {
        console.error(
          `[FilesController] Vercel Blob upload failed: ${err.message}`,
        );
      }
    }

    // 2. En LOCAL (ou MinIO sur VPS)
    if (!finalUrl && this.minio.isEnabled() && fileBuffer) {
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
        finalUrl = typeof url === 'string' ? url : (url as any).url || url;
      } catch (err) {
        if ((file as any)?.path && existsSync((file as any).path)) {
          try { rmSync((file as any).path); } catch {}
        }
        console.error(`[FilesController] MinIO audio upload failed: ${err.message}`);
        throw new BadRequestException(`Échec de l'upload audio vers MinIO: ${err.message}`);
      }
    }

    if ((file as any)?.path && existsSync((file as any).path)) {
      try { rmSync((file as any).path); } catch {}
    }

    if (!finalUrl) {
      throw new BadRequestException('MinIO storage service is not enabled or file buffer missing');
    }

    const userId = req?.body?.userId || req?.user?.id || req?.user?.sub || req?.user?.userId;
    const ext = extname(file.originalname).toLowerCase().replace('.', '');
    const title = file.originalname.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

    try {
      await this.mediaService.create({
        title,
        filename: file.originalname,
        fileUrl: finalUrl,
        type: 'audio',
        mimeType: file.mimetype || 'audio/mpeg',
        size: file.size || (fileBuffer ? fileBuffer.length : 0),
        duration: req?.body?.duration ? Number(req.body.duration) : 0,
        format: ext.toUpperCase(),
      }, userId);
    } catch (e: any) {
      console.warn(`[FilesController] Failed to auto-register audio MediaAsset: ${e.message}`);
    }

    return { url: finalUrl };
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
  async uploadImage(@UploadedFile() file?: Express.Multer.File, @Req() req?: any) {
    if (!file) return { error: 'No file' };

    // 1. Validation du format d'extension (WebP, JPG, JPEG, PNG)
    const extRaw = extname(file.originalname).toLowerCase().replace('.', '');
    const allowedExtensions = ['webp', 'jpg', 'jpeg', 'png'];
    if (!allowedExtensions.includes(extRaw)) {
      throw new BadRequestException(
        `Format d'image non supporté (.${extRaw || 'inconnu'}). Les formats autorisés sont : ${allowedExtensions.map((e) => `.${e.toUpperCase()}`).join(', ')}.`,
      );
    }

    // 2. Validation de la taille maximale (300 Ko)
    const MAX_IMAGE_SIZE = 300 * 1024; // 300 Ko
    const fileSize = file.size || (file.buffer ? file.buffer.length : 0);
    if (fileSize > MAX_IMAGE_SIZE) {
      throw new BadRequestException(
        `L'image dépasse la taille maximale autorisée de 300 Ko (${(fileSize / 1024).toFixed(1)} Ko reçus). Veuillez optimiser ou compresser votre image.`,
      );
    }

    // 2. Validation des dimensions minimales (Min 300x300 px)
    if (file.buffer) {
      const dimensions = getImageDimensions(file.buffer);
      if (dimensions) {
        const MIN_DIMENSION = 300;
        if (dimensions.width < MIN_DIMENSION || dimensions.height < MIN_DIMENSION) {
          throw new BadRequestException(
            `Les dimensions de l'image (${dimensions.width}×${dimensions.height} px) sont inférieures au minimum requis de ${MIN_DIMENSION}×${MIN_DIMENSION} px.`,
          );
        }
      }
    }

    const uniqueName = `${Date.now()}-${randomBytes(6).toString('hex')}${extname(file.originalname)}`;
    const isProduction =
      process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

    let finalUrl = '';

    // 1. En PRODUCTION : Priorité absolue à Vercel Blob
    if (isProduction && this.blob.isEnabled()) {
      try {
        const objectName = `images/${uniqueName}`;
        console.log(
          `[FilesController] Production: Uploading image to Vercel Blob: ${objectName}`,
        );
        finalUrl = await this.blob.upload({
          objectName,
          buffer: file.buffer,
          contentType: file.mimetype,
        });
      } catch (err) {
        console.error(
          `[FilesController] Vercel Blob Image upload failed: ${err.message}`,
        );
      }
    }

    // 2. Utilisation de MinIO
    if (!finalUrl && this.minio.isEnabled()) {
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
        finalUrl = typeof url === 'string' ? url : (url as any).url || url;
      } catch (err) {
        console.error(
          `[FilesController] MinIO Image upload failed: ${err.message}`,
        );
        throw new BadRequestException(`Échec de l'upload d'image vers MinIO: ${err.message}`);
      }
    }

    if (!finalUrl) {
      throw new BadRequestException('MinIO storage service is not enabled');
    }

    const userId = req?.body?.userId || req?.user?.id || req?.user?.sub || req?.user?.userId;
    const ext = extname(file.originalname).toLowerCase().replace('.', '');
    const title = file.originalname.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

    try {
      await this.mediaService.create({
        title,
        filename: file.originalname,
        fileUrl: finalUrl,
        thumbnailUrl: finalUrl,
        type: 'image',
        mimeType: file.mimetype || 'image/jpeg',
        size: file.size || (file.buffer ? file.buffer.length : 0),
        duration: 0,
        format: ext.toUpperCase(),
      }, userId);
    } catch (e: any) {
      console.warn(`[FilesController] Failed to auto-register image MediaAsset: ${e.message}`);
    }

    return { url: finalUrl };
  }

  @Post('analyze-video')
  @UseInterceptors(FileInterceptor('file', { storage: diskVideoStorage() }))
  async analyzeVideo(
    @UploadedFile() file?: Express.Multer.File,
    @Req() req?: any,
  ) {
    const url = req?.body?.url;
    if (!file && url && (url.includes('/hls/') || url.endsWith('.m3u8'))) {
      const inspected = await this.hlsTranscoder.inspectVideoVariants(url);
      return inspected.analysis;
    }

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

  @Post('inspect-video-variants')
  async inspectVideoVariantsPost(@Req() req: any) {
    const url = req?.body?.url || req?.query?.url || '';
    return this.hlsTranscoder.inspectVideoVariants(url);
  }

  @Get('inspect-video-variants')
  async inspectVideoVariantsGet(@Query('url') url: string) {
    return this.hlsTranscoder.inspectVideoVariants(url || '');
  }

  @Post('generate-video-variants')
  @UseInterceptors(FileInterceptor('file', { storage: diskVideoStorage() }))
  async generateVideoVariants(
    @UploadedFile() file?: Express.Multer.File,
    @Req() req?: any,
  ) {
    const url = req?.body?.url;
    if (!file && url && (url.includes('/hls/') || url.endsWith('.m3u8'))) {
      return this.hlsTranscoder.inspectVideoVariants(url);
    }

    let targetPath = file?.path;
    let cleanupNeeded = false;

    if (!targetPath && url) {
      if (url.includes('/uploads/')) {
        const relativePath = url.substring(url.indexOf('/uploads/'));
        const diskPath = join(process.cwd(), relativePath);
        if (existsSync(diskPath)) targetPath = diskPath;
      }
      if (!targetPath && this.minio.isEnabled()) {
        const match = url.match(/\/(videos|play-videos)\/([^?]+)(\?.*)?$/);
        if (match && match[2]) {
          const bucket = match[1] === 'play-videos' ? 'videos' : match[1];
          const objectName = match[2];
          try {
            const { stream } = await this.minio.getObjectStream(bucket, objectName);
            const tempName = `transcode-${Date.now()}-${randomBytes(4).toString('hex')}.mp4`;
            const tempPath = join(process.cwd(), 'uploads', 'videos', tempName);
            ensureDir(join(process.cwd(), 'uploads', 'videos'));
            const writeStream = createWriteStream(tempPath);
            await new Promise<void>((resolve, reject) => {
              stream.pipe(writeStream);
              stream.on('error', reject);
              writeStream.on('finish', () => resolve());
              writeStream.on('error', reject);
            });
            if (existsSync(tempPath)) {
              targetPath = tempPath;
              cleanupNeeded = true;
            }
          } catch (e: any) {
            console.warn('[generateVideoVariants] MinIO stream download failed, falling back to HTTP fetch:', e.message);
          }
        }
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
  async uploadVideo(@UploadedFile() file?: Express.Multer.File, @Req() req?: any) {
    if (!file) return { error: 'No file' };

    const uniqueName = file.filename || `${Date.now()}-${randomBytes(6).toString('hex')}${extname(file.originalname)}`;
    const isProduction =
      process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

    const fileBuffer = file.buffer || (file.path ? readFileSync(file.path) : null);

    if (!fileBuffer && !file.path) {
      console.error('[FilesController] Error: fileBuffer is null or undefined for video upload');
      return { error: 'No video file buffer available' };
    }

    // Probing source video metadata & extracting video poster snapshot
    let analysis: any = null;
    let posterUrl: string | null = null;

    if (file.path && existsSync(file.path)) {
      analysis = await this.hlsTranscoder.analyzeVideo(file.path);
      try {
        const posterBaseName = `${Date.now()}-${randomBytes(6).toString('hex')}`;
        posterUrl = await this.hlsTranscoder.generateAndUploadPoster(file.path, posterBaseName);
      } catch (err: any) {
        console.warn(`[FilesController] Could not generate video poster: ${err.message}`);
      }
    }

    let finalUrl = '';

    if (isProduction && this.blob.isEnabled() && fileBuffer) {
      try {
        const objectName = `videos/${uniqueName}`;
        finalUrl = await this.blob.upload({
          objectName,
          buffer: fileBuffer,
          contentType: file.mimetype,
        });
      } catch (err) {
        console.error(
          `[FilesController] Vercel Blob video upload failed: ${err.message}`,
        );
      }
    }

    if (!finalUrl && this.minio.isEnabled() && fileBuffer) {
      try {
        console.log(`[FilesController] Uploading video to MinIO: ${uniqueName}`);
        const url = await this.minio.upload({
          bucket: 'videos',
          objectName: uniqueName,
          buffer: fileBuffer,
          contentType: file.mimetype || 'video/mp4',
        });
        finalUrl = typeof url === 'string' ? url : (url as any).url || url;
      } catch (err) {
        if (file.path && existsSync(file.path)) {
          try { rmSync(file.path); } catch {}
        }
        console.error(`[FilesController] MinIO video upload failed: ${err.message}`);
        throw new BadRequestException(`Échec de l'upload vidéo vers MinIO: ${err.message}`);
      }
    }

    if (file.path && existsSync(file.path)) {
      try { rmSync(file.path); } catch {}
    }

    if (!finalUrl) {
      throw new BadRequestException('Storage service is not enabled');
    }

    const userId = req?.body?.userId || req?.user?.id || req?.user?.sub || req?.user?.userId;
    const ext = extname(file.originalname).toLowerCase().replace('.', '');
    const title = file.originalname.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

    try {
      await this.mediaService.create({
        title,
        filename: file.originalname,
        fileUrl: finalUrl,
        thumbnailUrl: posterUrl || analysis?.thumbnailUrl || undefined,
        type: 'video',
        mimeType: file.mimetype || 'video/mp4',
        size: file.size || (fileBuffer ? fileBuffer.length : 0),
        duration: analysis?.duration ? Math.round(analysis.duration) : 0,
        format: ext.toUpperCase(),
      }, userId);
    } catch (e: any) {
      console.warn(`[FilesController] Failed to auto-register video MediaAsset: ${e.message}`);
    }

    return {
      url: finalUrl,
      rawUrl: finalUrl,
      posterUrl,
      thumbnailUrl: posterUrl || analysis?.thumbnailUrl || undefined,
      analysis,
    };
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
          const bucket = match[1] === 'play-videos' ? 'videos' : match[1];
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
