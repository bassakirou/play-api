import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { VideoPlaylistsController } from './video-playlists.controller';
import { VideoPlaylistsService } from './video-playlists.service';

@Module({
  imports: [PassportModule],
  controllers: [VideoPlaylistsController],
  providers: [VideoPlaylistsService],
})
export class VideoPlaylistsModule {}
