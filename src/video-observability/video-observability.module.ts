import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { VideoDeliveryModule } from '../video-delivery/video-delivery.module';
import {
  DeliveryAdminGuard,
  OptionalDeliveryJwtGuard,
} from '../video-delivery/video-delivery.controller';
import { VideoObservabilityController } from './video-observability.controller';
import { VideoSessionService } from './video-session.service';
import { VideoMonitorService } from './video-monitor.service';
import { HostMetricsService } from './host-metrics.service';
import { CloudflareUsageService } from './cloudflare-usage.service';
import { ExternalProbeService } from './external-probe.service';

@Module({
  imports: [VideoDeliveryModule, PassportModule],
  controllers: [VideoObservabilityController],
  providers: [
    VideoSessionService,
    VideoMonitorService,
    HostMetricsService,
    CloudflareUsageService,
    ExternalProbeService,
    DeliveryAdminGuard,
    OptionalDeliveryJwtGuard,
  ],
})
export class VideoObservabilityModule {}
