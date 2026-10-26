import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { CloudflareStreamService } from './cloudflare-stream.service';
import { VideoDeliveryService } from './video-delivery.service';
import {
  DeliveryAdminGuard,
  OptionalDeliveryJwtGuard,
  VideoDeliveryController,
} from './video-delivery.controller';

@Module({
  imports: [PassportModule],
  controllers: [VideoDeliveryController],
  providers: [
    CloudflareStreamService,
    VideoDeliveryService,
    DeliveryAdminGuard,
    OptionalDeliveryJwtGuard,
  ],
  exports: [VideoDeliveryService, CloudflareStreamService],
})
export class VideoDeliveryModule {}
