import {
  Body,
  Controller,
  Delete,
  Get,
  Req,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CheckPermissions } from '../auth/permissions.decorator';
import { CreateVideoDto } from './dto/create-video.dto';
import { VideosService } from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) { }

  @Get()
  findAll() {
    return this.videosService.findAll();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @CheckPermissions('read:video')
  @Get('admin')
  findAllAdmin() {
    return this.videosService.findAllAdmin();
  }

  @Get('artist/:artistId')
  findByArtist(@Param('artistId') artistId: string) {
    return this.videosService.findByArtist(artistId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.videosService.findOne(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @CheckPermissions('create:video')
  @Post()
  create(@Req() req: any, @Body() dto: CreateVideoDto) {
    return this.videosService.create(dto, req.user?.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('me')
  createMyVideo(@Req() req: any, @Body() body: any) {
    return this.videosService.createForUser(req.user.userId, body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @CheckPermissions('update:video')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: any) {
    return this.videosService.update(id, dto);
  }

  @Patch(':id')
  updateMetrics(@Param('id') id: string, @Body() body: any) {
    const incrementViews = !!body?.incrementViews;
    const likeDelta =
      typeof body?.likeDelta === 'number' ? Number(body.likeDelta) : undefined;
    return this.videosService.updateMetrics(id, { incrementViews, likeDelta });
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @CheckPermissions('delete:video')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.videosService.remove(id);
  }
}
