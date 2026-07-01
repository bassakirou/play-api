import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [PassportModule],
  controllers: [VideosController],
  providers: [VideosService],
})
export class VideosModule {}
