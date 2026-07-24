/* eslint-disable no-empty */
import {
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { Readable } from 'stream';

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
      let target = url;
      if (!target.includes('public.blob.vercel-storage.com') && this.minio.isEnabled()) {
        const match = target.match(/\/images\/([^?]+)(\?.*)?$/);
        if (match && match[1]) {
          const objectName = match[1];
          target = await this.minio.presignGet({
            bucket: 'images',
            objectName,
          });
        }
      }

      const headers: Record<string, string> = {};
      const range = req?.headers?.range;
      if (typeof range === 'string' && range.length > 0) {
        headers.Range = range;
      }

      const upstream = await fetch(target, { headers });

      if (upstream.status === 404) {
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
    } catch {
      res.status(500).send('Failed to resolve image');
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
          `[FilesController] ${env}: Uploading audio to Minio: ${uniqueName}`,
        );
        const url = await this.minio.upload({
          bucket: 'audio',
          objectName: uniqueName,
          buffer: fileBuffer,
          contentType: file.mimetype || 'audio/mpeg',
        });
        return { url: typeof url === 'string' ? url : (url as any).url || url };
      } catch (err) {
        console.error(`[FilesController] Minio audio upload failed: ${err.message}`);
      }
    }

    // 3. Fallback Local (disque)
    try {
      if (fileBuffer) {
        const dest = join(process.cwd(), 'uploads', 'audio');
        ensureDir(dest);
        const filename = uniqueName;
        writeFileSync(join(dest, filename), fileBuffer);
        return {
          url: `/uploads/audio/${filename}`,
          objectName: filename,
        };
      }
    } catch (err) {
      console.error(`[FilesController] Local audio fallback failed: ${err.message}`);
    }

    throw new Error('All audio upload storage attempts failed');
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

    // 2. En LOCAL (ou fallback production) : Utilisation de Minio
    if (this.minio.isEnabled()) {
      try {
        const env = isProduction ? 'Production Fallback' : 'Local';
        console.log(
          `[FilesController] ${env}: Uploading image to Minio: ${uniqueName}`,
        );
        const url = await this.minio.upload({
          bucket: 'images',
          objectName: uniqueName, // On enlève le préfixe images/ ici car le bucket s'appelle déjà images
          buffer: file.buffer,
          contentType: file.mimetype,
        });
        // On s'assure de renvoyer un objet JSON { url: "..." }
        return { url: typeof url === 'string' ? url : (url as any).url || url };
      } catch (err) {
        console.error(
          `[FilesController] Minio Image upload failed: ${err.message}`,
        );
      }
    }

    // 3. Fallback disque local
    try {
      if (!file.filename && file.buffer) {
        const dest = join(process.cwd(), 'uploads', 'images');
        ensureDir(dest);
        const filename = `${Date.now()}-${randomBytes(8).toString('hex')}${extname(file.originalname)}`;
        writeFileSync(join(dest, filename), file.buffer);
        return {
          url: `/uploads/images/${filename}`,
          objectName: filename,
        };
      }
      if (file.filename) {
        return {
          url: `/uploads/images/${file.filename}`,
          objectName: file.filename,
        };
      }
      throw new Error('No local file data available');
    } catch (err) {
      console.error(`[FilesController] Local fallback failed: ${err.message}`);
      return {
        url: 'https://placehold.co/400x400?text=Upload+Failed+Check+Logs',
      };
    }
  }

  @Post('upload-video')
  @UseInterceptors(
    FileInterceptor(
      'file',
      process.env.BLOB_READ_WRITE_TOKEN || process.env.MINIO_ENDPOINT
        ? { storage: memoryStorage(), limits: { fileSize: 1024 * 1024 * 500 } }
        : {
          storage: diskVideoStorage(),
          limits: { fileSize: 1024 * 1024 * 500 },
        },
    ),
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

    const uniqueName = `${Date.now()}-${randomBytes(6).toString('hex')}${extname(file.originalname)}`;
    const isProduction =
      process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

    if (isProduction && this.blob.isEnabled()) {
      try {
        const objectName = `videos/${uniqueName}`;
        const url = await this.blob.upload({
          objectName,
          buffer: file.buffer,
          contentType: file.mimetype,
        });
        return { url };
      } catch (err) {
        console.error(
          `[FilesController] Vercel Blob video upload failed: ${err.message}`,
        );
      }
    }

    if (this.minio.isEnabled()) {
      try {
        const url = await this.minio.upload({
          bucket: 'videos',
          objectName: uniqueName,
          buffer: file.buffer,
          contentType: file.mimetype,
        });
        return { url: typeof url === 'string' ? url : (url as any).url || url };
      } catch (err) {
        console.error(`[FilesController] Minio video upload failed: ${err.message}`);
      }
    }

    try {
      if (!file.filename && file.buffer) {
        const dest = join(process.cwd(), 'uploads', 'videos');
        ensureDir(dest);
        const filename = `${Date.now()}-${randomBytes(8).toString('hex')}${extname(file.originalname)}`;
        writeFileSync(join(dest, filename), file.buffer);
        return {
          url: `/uploads/videos/${filename}`,
          objectName: filename,
        };
      }
      if (file.filename) {
        return {
          url: `/uploads/videos/${file.filename}`,
          objectName: file.filename,
        };
      }
      throw new Error('No local file data available');
    } catch (err) {
      console.error(`[FilesController] Local video fallback failed: ${err.message}`);
      return {
        url: 'https://placehold.co/400x400?text=Upload+Failed+Check+Logs',
      };
    }
  }

  @Get('resolved-audio')
  async resolvedAudio(@Query('url') url: string, @Req() req: any, @Res() res: any) {
    if (!url) {
      res.status(400).send('Missing url');
      return;
    }
    try {
      let target = url;
      if (!target.includes('public.blob.vercel-storage.com') && this.minio.isEnabled()) {
        const match = target.match(/\/(audio|play-audio)\/([^?]+)(\?.*)?$/);
        if (match && match[2]) {
          const bucket = match[1] === 'play-audio' ? 'play-audio' : 'audio';
          const objectName = match[2];
          target = await this.minio.presignGet({
            bucket: bucket as any,
            objectName,
          });
        }
      }

      const headers: Record<string, string> = {};
      const range = req?.headers?.range;
      if (typeof range === 'string' && range.length > 0) {
        headers.Range = range;
      }

      const upstream = await fetch(target, { headers });

      res.status(upstream.status);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
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
    } catch {
      res.status(500).send('Failed to resolve audio');
    }
  }

  @Get('resolved-video')
  async resolvedVideo(@Query('url') url: string, @Req() req: any, @Res() res: any) {
    if (!url) {
      res.status(400).send('Missing url');
      return;
    }

    try {
      let target = url;
      if (!target.includes('public.blob.vercel-storage.com') && this.minio.isEnabled()) {
        const match = target.match(/\/(videos|play-videos)\/([^?]+)(\?.*)?$/);
        if (match && match[2]) {
          const bucket = match[1] === 'play-videos' ? 'play-videos' : 'videos';
          const objectName = match[2];
          target = await this.minio.presignGet({
            bucket: bucket as any,
            objectName,
          });
        }
      }

      const headers: Record<string, string> = {};
      const range = req?.headers?.range;
      if (typeof range === 'string' && range.length > 0) {
        headers.Range = range;
      }

      const upstream = await fetch(target, { headers });

      res.status(upstream.status);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
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
    } catch {
      res.status(500).send('Failed to resolve video');
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
