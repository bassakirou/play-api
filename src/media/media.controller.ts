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
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { MediaService } from './media.service';
import { CreateMediaAssetDto } from './dto/create-media-asset.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get()
  @ApiOperation({ summary: 'Lister les médias de la bibliothèque avec isolation utilisateur stricte' })
  @ApiQuery({ name: 'type', required: false, enum: ['all', 'audio', 'video', 'image'] })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'userId', required: false })
  findAll(
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('userId') queryUserId?: string,
    @Req() req?: any,
  ) {
    const callerRole = req?.user?.role;
    const callerId = req?.user?.userId || req?.user?.id || req?.user?.sub;
    const isAdmin = callerRole === 'ADMIN' || callerRole === 'SUPER_ADMIN';

    // If caller is NOT an admin, they can ONLY see their own media assets
    const effectiveUserId = isAdmin ? (queryUserId || undefined) : callerId;
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
    const callerRole = req?.user?.role;
    const callerId = req?.user?.userId || req?.user?.id || req?.user?.sub;
    const isAdmin = callerRole === 'ADMIN' || callerRole === 'SUPER_ADMIN';
    const effectiveUserId = (isAdmin && bodyUserId) ? bodyUserId : callerId;
    const parsedDuration = duration ? Number(duration) : undefined;
    return this.mediaService.uploadAndCreate(file, { title, type, duration: parsedDuration }, effectiveUserId);
  }

  @Post()
  @ApiOperation({ summary: 'Créer manuellement un enregistrement de média dans la bibliothèque' })
  create(@Body() dto: CreateMediaAssetDto, @Req() req?: any) {
    const callerRole = req?.user?.role;
    const callerId = req?.user?.userId || req?.user?.id || req?.user?.sub;
    const isAdmin = callerRole === 'ADMIN' || callerRole === 'SUPER_ADMIN';
    const effectiveUserId = (isAdmin && dto.userId) ? dto.userId : callerId;
    return this.mediaService.create(dto, effectiveUserId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Supprimer un média de la bibliothèque' })
  delete(@Param('id') id: string, @Req() req?: any) {
    const callerRole = req?.user?.role;
    const callerId = req?.user?.userId || req?.user?.id || req?.user?.sub;
    const isAdmin = callerRole === 'ADMIN' || callerRole === 'SUPER_ADMIN';
    return this.mediaService.delete(id, isAdmin ? undefined : callerId);
  }
}
