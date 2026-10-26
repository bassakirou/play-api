import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { VideoDeliveryModule } from '../video-delivery/video-delivery.module';

@Module({
  imports: [PassportModule, VideoDeliveryModule],
  controllers: [VideosController],
  providers: [VideosService],
})
export class VideosModule {}
