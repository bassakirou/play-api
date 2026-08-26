import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../storage/minio.service';
import { VercelBlobService } from '../storage/vercel-blob.service';
import { HlsTranscoderService } from '../storage/hls-transcoder.service';
import { CreateMediaAssetDto } from './dto/create-media-asset.dto';
import { extname } from 'path';
import { randomBytes } from 'crypto';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly blob: VercelBlobService,
    private readonly hlsTranscoder: HlsTranscoderService,
  ) {}

  async findAll(params?: { type?: string; search?: string; userId?: string }) {
    const { type, search, userId } = params || {};
    try {
      const where: any = {};
      if (type && type !== 'all') {
        where.type = type;
      }
      if (search) {
        where.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { filename: { contains: search, mode: 'insensitive' } },
        ];
      }
      if (userId) {
        where.userId = userId;
      }

      const assets = await (this.prisma as any).mediaAsset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
      return assets || [];
    } catch (e: any) {
      this.logger.error(`Prisma MediaAsset findAll failed: ${e.message}`);
      return [];
    }
  }

  async findOne(id: string) {
    try {
      const item = await (this.prisma as any).mediaAsset.findUnique({ where: { id } });
      return item || null;
    } catch (e: any) {
      this.logger.error(`Prisma findUnique failed: ${e.message}`);
      return null;
    }
  }

  async create(dto: CreateMediaAssetDto, userId?: string) {
    const itemData = {
      title: dto.title || dto.filename,
      filename: dto.filename,
      fileUrl: dto.fileUrl,
      thumbnailUrl: dto.thumbnailUrl || (dto.type === 'image' ? dto.fileUrl : undefined),
      type: dto.type,
      mimeType: dto.mimeType,
      size: dto.size || 0,
      duration: dto.duration || 0,
      format: dto.format || dto.filename.split('.').pop()?.toUpperCase() || '',
      userId: userId || undefined,
    };

    try {
      const created = await (this.prisma as any).mediaAsset.create({
        data: itemData,
      });
      return created;
    } catch (e: any) {
      this.logger.error(`Prisma MediaAsset create failed: ${e.message}`);
      throw new BadRequestException("Impossible d'enregistrer l'élément média dans la base de données.");
    }
  }

  async uploadAndCreate(
    file: Express.Multer.File,
    meta?: { title?: string; duration?: number; type?: 'audio' | 'video' | 'image' },
    userId?: string,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier fourni');

    const ext = extname(file.originalname).toLowerCase().replace('.', '');
    const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(ext) || file.mimetype.startsWith('image/');
    const isAudio = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'wma'].includes(ext) || file.mimetype.startsWith('audio/');
    const isVideo = ['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext) || file.mimetype.startsWith('video/');

    const detectedType: 'audio' | 'video' | 'image' =
      meta?.type || (isAudio ? 'audio' : isVideo ? 'video' : 'image');

    const bucket = detectedType === 'audio' ? 'audio' : detectedType === 'video' ? 'videos' : 'images';
    const uniqueName = `${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`;
    const fileBuffer = file.buffer;

    let fileUrl = '';

    if (this.blob.isEnabled() && fileBuffer) {
      try {
        fileUrl = await this.blob.upload({
          bucket,
          objectName: uniqueName,
          buffer: fileBuffer,
          contentType: file.mimetype,
        });
      } catch (err: any) {
        this.logger.error(`Vercel Blob upload failed: ${err.message}`);
      }
    }

    if (!fileUrl && this.minio.isEnabled() && fileBuffer) {
      try {
        const uploadRes = await this.minio.upload({
          bucket,
          objectName: uniqueName,
          buffer: fileBuffer,
          contentType: file.mimetype,
        });
        fileUrl = typeof uploadRes === 'string' ? uploadRes : (uploadRes as any).url || uploadRes;
      } catch (err: any) {
        this.logger.error(`MinIO upload failed: ${err.message}`);
        throw new BadRequestException(`Échec de l'upload du média vers MinIO: ${err.message}`);
      }
    }

    if (!fileUrl) {
      throw new BadRequestException("Service de stockage MinIO indisponible pour l'enregistrement du média.");
    }

    const title = meta?.title || file.originalname.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    const format = ext.toUpperCase();
    const size = file.size || (fileBuffer ? fileBuffer.length : 0);
    const duration = meta?.duration || 0;

    return this.create(
      {
        title,
        filename: file.originalname,
        fileUrl,
        thumbnailUrl: detectedType === 'image' ? fileUrl : undefined,
        type: detectedType,
        mimeType: file.mimetype,
        size,
        duration,
        format,
      },
      userId,
    );
  }

  async delete(id: string) {
    try {
      await (this.prisma as any).mediaAsset.delete({ where: { id } });
    } catch (e: any) {
      this.logger.error(`Prisma delete failed: ${e.message}`);
    }
    return { success: true, id };
  }
}
