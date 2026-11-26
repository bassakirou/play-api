import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Header,
  Injectable, Module, Patch, PayloadTooLargeException, Req, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MediaSourceOwnershipService } from '../content-access/media-source-ownership.service';
import { PrismaService } from '../prisma/prisma.service';

const defaults = { avatarKiB: 300, bannerKiB: 300, imageKiB: 300, audioMiB: 500, videoMiB: 500 };
const keys = Object.keys(defaults) as (keyof typeof defaults)[];
const fields = {
  avatar: 'avatarKiB', banner: 'bannerKiB', image: 'imageKiB',
  audio: 'audioMiB', video: 'videoMiB',
} as const;
const labels = { avatar: 'La photo de profil', banner: 'La bannière', image: 'L’image', audio: 'Le fichier audio', video: 'La vidéo' };
export type UploadKind = keyof typeof fields;

export function imageUploadKind(value: unknown): 'avatar' | 'banner' | 'image' {
  if (value === undefined || value === 'image') return 'image';
  if (value === 'avatar' || value === 'banner') return value;
  throw new BadRequestException('Type de téléversement d’image invalide.');
}

@Injectable()
export class MediaUploadSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    const record = await this.prisma.mediaUploadConfig.findUnique({
      where: { id: 'default' },
      select: { avatarKiB: true, bannerKiB: true, imageKiB: true, audioMiB: true, videoMiB: true },
    });
    return record ?? defaults;
  }

  async update(body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Données de téléversement invalides.');
    }
    const params = body as Record<string, unknown>;
    if (Object.keys(params).length !== keys.length) {
      throw new BadRequestException('Les cinq plafonds sont obligatoires.');
    }
    const config = { ...defaults };
    for (const key of keys) {
      const value = params[key];
      const image = key.endsWith('KiB');
      const minimum = image ? 16 : 1;
      const maximum = image ? 2048 : 500;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
        throw new BadRequestException(`Chaque plafond doit être un entier entre ${minimum} et ${maximum} ${image ? 'Ko' : 'Mo'}.`);
      }
      config[key] = value;
    }
    const { id, ...record } = await this.prisma.mediaUploadConfig.upsert({
      where: { id: 'default' },
      create: config,
      update: config,
    });
    return record;
  }

  async limit(kind: UploadKind) {
    const key = fields[kind];
    const size = (await this.get())[key];
    const image = key.endsWith('KiB');
    return {
      bytes: size * (image ? 1024 : 1024 * 1024),
      message: `${labels[kind]} dépasse le maximum autorisé de ${size} ${image ? 'Ko' : 'Mo'}. Réduisez la taille du fichier avant de réessayer.`,
    };
  }

  async assertSize(kind: UploadKind, bytes: number) {
    const limit = await this.limit(kind);
    if (bytes > limit.bytes) throw new PayloadTooLargeException(limit.message);
  }
}

@Controller('files/upload-limits')
export class MediaUploadSettingsController {
  constructor(
    private readonly settings: MediaUploadSettingsService,
    private readonly accounts: MediaSourceOwnershipService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get() {
    return this.settings.get();
  }

  @Patch()
  @UseGuards(JwtAuthGuard)
  async update(@Req() request: { user: { userId: string } }, @Body() body: unknown) {
    if (!(await this.accounts.isAdmin(request.user.userId))) {
      throw new ForbiddenException('Seuls les administrateurs peuvent modifier les plafonds de téléversement.');
    }
    return this.settings.update(body);
  }
}

@Module({
  controllers: [MediaUploadSettingsController],
  providers: [MediaUploadSettingsService],
  exports: [MediaUploadSettingsService],
})
export class MediaUploadSettingsModule {}
