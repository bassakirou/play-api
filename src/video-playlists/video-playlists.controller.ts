import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateVideoPlaylistDto } from './dto/create-video-playlist.dto';
import { VideoPlaylistsService } from './video-playlists.service';

@ApiTags('video-playlists')
@Controller('video-playlists')
export class VideoPlaylistsController {
  constructor(private readonly videoPlaylistsService: VideoPlaylistsService) { }

  @Get('artist/:artistId')
  findByArtist(@Param('artistId') artistId: string) {
    return this.videoPlaylistsService.findPublicByArtist(artistId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get()
  findMine(@Req() req: any) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.videoPlaylistsService.findMine(userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.videoPlaylistsService.findOne(userId, id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Req() req: any,
    @Body() dto: CreateVideoPlaylistDto,
  ) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.videoPlaylistsService.create(userId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/videos/:videoId')
  addVideo(
    @Req() req: any,
    @Param('id') id: string,
    @Param('videoId') videoId: string,
  ) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.videoPlaylistsService.addVideo(userId, id, videoId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id/videos/:videoId')
  removeVideo(
    @Req() req: any,
    @Param('id') id: string,
    @Param('videoId') videoId: string,
  ) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.videoPlaylistsService.removeVideo(userId, id, videoId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  delete(@Req() req: any, @Param('id') id: string) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.videoPlaylistsService.delete(userId, id);
  }
}
