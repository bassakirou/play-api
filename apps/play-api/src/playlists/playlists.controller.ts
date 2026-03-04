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
import { PlaylistsService } from './playlists.service';
import { CreatePlaylistDto } from './dto/create-playlist.dto';

@ApiTags('playlists')
@ApiBearerAuth()
@Controller('playlists')
@UseGuards(JwtAuthGuard)
export class PlaylistsController {
  constructor(private playlistsService: PlaylistsService) {}

  @Get()
  getMine(@Req() req: { user: { userId: string } }) {
    return this.playlistsService.findMine(req.user.userId);
  }

  @Post()
  create(
    @Req() req: { user: { userId: string } },
    @Body() dto: CreatePlaylistDto,
  ) {
    return this.playlistsService.create(req.user.userId, dto.name);
  }

  @Delete(':id')
  delete(@Req() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.playlistsService.delete(req.user.userId, id);
  }

  @Post(':id/songs/:songId')
  addSong(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
    @Param('songId') songId: string,
  ) {
    return this.playlistsService.addSong(req.user.userId, id, songId);
  }

  @Delete(':id/songs/:songId')
  removeSong(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
    @Param('songId') songId: string,
  ) {
    return this.playlistsService.removeSong(req.user.userId, id, songId);
  }
}
