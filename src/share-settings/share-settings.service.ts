import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateSharePlatformDto {
  key: string;
  name: string;
  icon: string;
  shareUrl: string;
  enabled?: boolean;
  order?: number;
  color?: string;
  includeTitle?: boolean;
  includeAuthor?: boolean;
  includeDescription?: boolean;
  defaultHashtags?: string;
}

export interface UpdateSharePlatformDto {
  name?: string;
  icon?: string;
  shareUrl?: string;
  enabled?: boolean;
  order?: number;
  color?: string;
  includeTitle?: boolean;
  includeAuthor?: boolean;
  includeDescription?: boolean;
  defaultHashtags?: string;
}

@Injectable()
export class ShareSettingsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Retourne les plateformes activées pour le front public (triées par ordre)
   */
  async findActive() {
    return this.prisma.sharePlatform.findMany({
      where: { enabled: true },
      orderBy: { order: 'asc' },
    });
  }

  /**
   * Retourne toutes les plateformes (admin)
   */
  async findAll() {
    return this.prisma.sharePlatform.findMany({
      orderBy: { order: 'asc' },
    });
  }

  async findOne(id: string) {
    const platform = await this.prisma.sharePlatform.findUnique({
      where: { id },
    });
    if (!platform) {
      throw new NotFoundException(`Plateforme de partage introuvable: ${id}`);
    }
    return platform;
  }

  async create(dto: CreateSharePlatformDto) {
    const existing = await this.prisma.sharePlatform.findUnique({
      where: { key: dto.key.toLowerCase().trim() },
    });
    if (existing) {
      throw new BadRequestException(`Une plateforme avec la clé "${dto.key}" existe déjà.`);
    }

    return this.prisma.sharePlatform.create({
      data: {
        key: dto.key.toLowerCase().trim(),
        name: dto.name,
        icon: dto.icon || 'share',
        shareUrl: dto.shareUrl,
        enabled: dto.enabled !== undefined ? dto.enabled : true,
        order: dto.order ?? 0,
        color: dto.color,
        includeTitle: dto.includeTitle !== undefined ? dto.includeTitle : true,
        includeAuthor: dto.includeAuthor !== undefined ? dto.includeAuthor : true,
        includeDescription: dto.includeDescription !== undefined ? dto.includeDescription : false,
        defaultHashtags: dto.defaultHashtags,
      },
    });
  }

  async update(id: string, dto: UpdateSharePlatformDto) {
    await this.findOne(id);

    return this.prisma.sharePlatform.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.shareUrl !== undefined && { shareUrl: dto.shareUrl }),
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(dto.order !== undefined && { order: dto.order }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.includeTitle !== undefined && { includeTitle: dto.includeTitle }),
        ...(dto.includeAuthor !== undefined && { includeAuthor: dto.includeAuthor }),
        ...(dto.includeDescription !== undefined && { includeDescription: dto.includeDescription }),
        ...(dto.defaultHashtags !== undefined && { defaultHashtags: dto.defaultHashtags }),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.sharePlatform.delete({
      where: { id },
    });
  }
}
