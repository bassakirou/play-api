import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  DeliveryAdminGuard,
  OptionalDeliveryJwtGuard,
} from '../video-delivery/video-delivery.controller';
import { VideoSessionService } from './video-session.service';
import { VideoMonitorService } from './video-monitor.service';
import { StartVideoSessionDto, VideoPulseDto } from './video-session.dto';
import { ExternalProbeService } from './external-probe.service';

@Controller('video-observability')
export class VideoObservabilityController {
  constructor(
    private readonly sessions: VideoSessionService,
    private readonly monitor: VideoMonitorService,
    private readonly probes: ExternalProbeService,
  ) {}

  @Post('sessions')
  @UseGuards(OptionalDeliveryJwtGuard)
  start(
    @Body() dto: StartVideoSessionDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    res.setHeader('Cache-Control', 'private, no-store');
    return this.sessions.start(dto.videoId, req.user, req.ip);
  }

  @Post('sessions/:id/pulse')
  pulse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VideoPulseDto) {
    return this.sessions.pulse(id, dto);
  }

  @Get('overview')
  @UseGuards(JwtAuthGuard, DeliveryAdminGuard)
  overview(
    @Query('range') range: string,
    @Query('host') host: string,
    @Res({ passthrough: true }) res: any,
  ) {
    res.setHeader('Cache-Control', 'private, no-store');
    return this.monitor.overview(range, host);
  }

  @Post('alerts/:id/ack')
  @UseGuards(JwtAuthGuard, DeliveryAdminGuard)
  acknowledge(@Param('id', ParseUUIDPipe) id: string) {
    return this.monitor.acknowledge(id);
  }

  @Post('probe')
  probe(@Req() req: any, @Headers('x-probe-signature') signature?: string) {
    return this.probes.receive(req.rawBody, signature);
  }
}
