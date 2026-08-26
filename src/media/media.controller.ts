import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiQuery } from '@nestjs/swagger';
import { MediaService } from './media.service';
import { CreateMediaAssetDto } from './dto/create-media-asset.dto';

@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get()
  @ApiOperation({ summary: 'Lister les médias de la bibliothèque avec filtres' })
  @ApiQuery({ name: 'type', required: false, enum: ['all', 'audio', 'video', 'image'] })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'userId', required: false })
  findAll(
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('userId') userId?: string,
    @Req() req?: any,
  ) {
    const effectiveUserId = userId || req?.user?.id || req?.user?.sub || req?.user?.userId;
    return this.mediaService.findAll({ type, search, userId: effectiveUserId });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d’un média par son ID' })
  findOne(@Param('id') id: string) {
    return this.mediaService.findOne(id);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 1024 * 1024 * 500 }, // 500 MB
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Téléverser un fichier média (audio, vidéo, image) dans la bibliothèque' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string' },
        type: { type: 'string', enum: ['audio', 'video', 'image'] },
        duration: { type: 'number' },
        userId: { type: 'string' },
      },
    },
  })
  async uploadMedia(
    @UploadedFile() file: Express.Multer.File,
    @Body('title') title?: string,
    @Body('type') type?: 'audio' | 'video' | 'image',
    @Body('duration') duration?: string | number,
    @Body('userId') bodyUserId?: string,
    @Req() req?: any,
  ) {
    const parsedDuration = duration ? Number(duration) : undefined;
    const userId = bodyUserId || req?.user?.id || req?.user?.sub || req?.user?.userId;
    return this.mediaService.uploadAndCreate(file, { title, type, duration: parsedDuration }, userId);
  }

  @Post()
  @ApiOperation({ summary: 'Créer manuellement un enregistrement de média dans la bibliothèque' })
  create(@Body() dto: CreateMediaAssetDto, @Req() req?: any) {
    const userId = req?.user?.id || req?.user?.sub;
    return this.mediaService.create(dto, userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Supprimer un média de la bibliothèque' })
  delete(@Param('id') id: string) {
    return this.mediaService.delete(id);
  }
}
