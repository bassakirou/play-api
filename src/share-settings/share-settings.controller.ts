import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import {
  ShareSettingsService,
  CreateSharePlatformDto,
  UpdateSharePlatformDto,
} from './share-settings.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('share-settings')
@Controller('share-settings')
export class ShareSettingsController {
  constructor(private readonly shareSettingsService: ShareSettingsService) {}

  /**
   * Endpoint public pour récupérer les réseaux sociaux activés pour le partage
   */
  @Get()
  findActive() {
    return this.shareSettingsService.findActive();
  }

  /**
   * Endpoint pour l'administration (tous les réseaux configurés, actifs ou non)
   */
  @Get('all')
  findAll() {
    return this.shareSettingsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.shareSettingsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateSharePlatformDto) {
    return this.shareSettingsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSharePlatformDto) {
    return this.shareSettingsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.shareSettingsService.remove(id);
  }
}
