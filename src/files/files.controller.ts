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
  constructor(private readonly minio: MinioService) {}

  @Get('resolved-image')
  async resolvedImage(@Query('url') url: string, @Res() res: any) {
    if (!url) {
      res.status(400).send('Missing url');
      return;
    }
    try {
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
      process.env.MINIO_ENDPOINT
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

    // Tentative d'upload vers Minio (Production VPS KM 4)
    if (this.minio.isEnabled()) {
      const objectName = `${Date.now()}-${randomBytes(6).toString('hex')}${extname(file.originalname)}`;
      try {
        console.log(
          `[FilesController] Uploading audio to Minio VPS: ${objectName}`,
        );
        return await this.minio.upload({
          bucket: 'audio',
          objectName,
          buffer: file.buffer,
          contentType: file.mimetype,
        });
      } catch (err) {
        console.error(
          `[FilesController] Minio Audio upload failed: ${err.message}`,
        );
        throw new Error(`Failed to upload audio to storage: ${err.message}`);
      }
    }

    // Fallback local uniquement pour le développement local
    if (!file.filename && file.buffer) {
      const dest = join(process.cwd(), 'uploads', 'audio');
      ensureDir(dest);
      const filename = `${Date.now()}-${randomBytes(8).toString('hex')}${extname(file.originalname)}`;
      writeFileSync(join(dest, filename), file.buffer);
      return {
        url: `/uploads/audio/${filename}`,
        objectName: filename,
      };
    }
    const url = `/uploads/audio/${file.filename}`;
    return { url, objectName: file.filename };
  }

  @Post('upload-image')
  @UseInterceptors(
    FileInterceptor(
      'file',
      process.env.MINIO_ENDPOINT
        ? {
            storage: memoryStorage(),
            limits: { fileSize: 1024 * 1024 * 20 },
          }
        : {
            storage: diskStorage({
              destination: (_req, _file, cb) => {
                const dest = join(process.cwd(), 'uploads', 'images');
                ensureDir(dest);
                cb(null, dest);
              },
              filename: (_req, file, cb) => {
                const unique = randomBytes(8).toString('hex');
                cb(
                  null,
                  `${Date.now()}-${unique}${extname(file.originalname)}`,
                );
              },
            }),
            limits: { fileSize: 1024 * 1024 * 20 },
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
  async uploadImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) return { error: 'No file' };

    // Tentative d'upload vers Minio (Production VPS KM 4)
    if (this.minio.isEnabled()) {
      const objectName = `${Date.now()}-${randomBytes(6).toString('hex')}${extname(file.originalname)}`;
      try {
        console.log(
          `[FilesController] Uploading image to Minio VPS: ${objectName}`,
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
        throw new Error(`Failed to upload image to storage: ${err.message}`);
      }
    }

    // Fallback local uniquement pour le développement local
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
    const url = `/uploads/images/${file.filename}`;
    return { url, objectName: file.filename };
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
