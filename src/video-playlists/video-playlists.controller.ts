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
  findMine(@Req() req: { user: { userId: string } }) {
    return this.videoPlaylistsService.findMine(req.user.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Req() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.videoPlaylistsService.findOne(req.user.userId, id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Req() req: { user: { userId: string } },
    @Body() dto: CreateVideoPlaylistDto,
  ) {
    return this.videoPlaylistsService.create(req.user.userId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/videos/:videoId')
  addVideo(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
    @Param('videoId') videoId: string,
  ) {
    return this.videoPlaylistsService.addVideo(req.user.userId, id, videoId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id/videos/:videoId')
  removeVideo(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
    @Param('videoId') videoId: string,
  ) {
    return this.videoPlaylistsService.removeVideo(req.user.userId, id, videoId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  delete(@Req() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.videoPlaylistsService.delete(req.user.userId, id);
  }
}
