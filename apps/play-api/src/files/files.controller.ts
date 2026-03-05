/* eslint-disable no-empty */
import {
  Controller,
  Get,
  Post,
  Query,
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
import { existsSync, mkdirSync, writeFileSync } from 'fs';

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

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(
    private readonly minio: MinioService,
    private readonly blob: VercelBlobService,
  ) {}

  @Get('resolved-image')
  async resolvedImage(@Query('url') url: string, @Res() res: any) {
    if (!url) {
      res.status(400).send('Missing url');
      return;
    }
    try {
      // Priorité à Vercel Blob (les URLs sont déjà directes, donc on retourne tel quel)
      if (url.includes('public.blob.vercel-storage.com')) {
        res.redirect(url);
        return;
      }

      if (this.minio.isEnabled()) {
        const match = url.match(/\/images\/(.+)$/);
        if (match && match[1]) {
          const objectName = match[1];
          const signed = await this.minio.presignGet({
            bucket: 'images',
            objectName,
            contentType: 'image/*',
          });
          res.redirect(signed);
          return;
        }
      }
      res.redirect(url);
    } catch {
      res.redirect(url);
    }
  }

  @Post('upload-audio')
  @UseInterceptors(
    FileInterceptor(
      'file',
      process.env.BLOB_READ_WRITE_TOKEN || process.env.MINIO_ENDPOINT
        ? { storage: memoryStorage(), limits: { fileSize: 1024 * 1024 * 100 } }
        : {
            storage: diskAudioStorage(),
            limits: { fileSize: 1024 * 1024 * 100 },
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
  async uploadAudio(@UploadedFile() file?: Express.Multer.File) {
    if (!file) return { error: 'No file' };

    const objectName = `audio/${Date.now()}-${randomBytes(6).toString('hex')}${extname(file.originalname)}`;
    const isProduction =
      process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

    // 1. En PRODUCTION : Priorité absolue à Vercel Blob
    if (isProduction && this.blob.isEnabled()) {
      try {
        console.log(
          `[FilesController] Production: Uploading audio to Vercel Blob: ${objectName}`,
        );
        const url = await this.blob.upload({
          objectName,
          buffer: file.buffer,
          contentType: file.mimetype,
        });
        return { url };
      } catch (err) {
        console.error(
          `[FilesController] Vercel Blob upload failed: ${err.message}`,
        );
      }
    }

    // 2. En LOCAL (ou fallback production) : Utilisation de Minio
    if (this.minio.isEnabled()) {
      try {
        const env = isProduction ? 'Production Fallback' : 'Local';
        console.log(
          `[FilesController] ${env}: Uploading audio to Minio: ${objectName}`,
        );
        return await this.minio.upload({
          bucket: 'audio',
          objectName,
          buffer: file.buffer,
          contentType: file.mimetype,
        });
      } catch (err) {
        console.error(`[FilesController] Minio upload failed: ${err.message}`);
      }
    }

    // 3. Fallback Local (disque)
    if (file.filename) {
      return {
        url: `/uploads/audio/${file.filename}`,
        objectName: file.filename,
      };
    }

    throw new Error('All upload storage attempts failed');
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

    const objectName = `images/${Date.now()}-${randomBytes(6).toString('hex')}${extname(file.originalname)}`;
    const isProduction =
      process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

    // 1. En PRODUCTION : Priorité absolue à Vercel Blob
    if (isProduction && this.blob.isEnabled()) {
      try {
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
          `[FilesController] ${env}: Uploading image to Minio: ${objectName}`,
        );
        return await this.minio.upload({
          bucket: 'images',
          objectName,
          buffer: file.buffer,
          contentType: file.mimetype,
        });
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

  @Get('resolved-audio')
  async resolvedAudio(@Query('url') url: string, @Res() res: any) {
    if (!url) {
      res.status(400).send('Missing url');
      return;
    }
    try {
      if (this.minio.isEnabled()) {
        const match = url.match(/\/audio\/(.+)$/);
        if (match && match[1]) {
          const objectName = match[1];
          const signed = await this.minio.presignGet({
            bucket: 'audio',
            objectName,
            contentType: 'audio/mpeg',
          });
          res.redirect(signed);
          return;
        }
      }
      res.redirect(url);
    } catch {
      res.redirect(url);
    }
  }
}
