import {
  CanActivate,
  Controller,
  Get,
  Headers,
  Injectable,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { VideoDeliveryService } from './video-delivery.service';
import { CloudflareStreamService } from './cloudflare-stream.service';

@Injectable()
export class DeliveryAdminGuard implements CanActivate {
  canActivate(context: any) {
    return ['ADMIN', 'SUPER_ADMIN'].includes(
      context.switchToHttp().getRequest().user?.role,
    );
  }
}

@Injectable()
export class OptionalDeliveryJwtGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any, info: any, context: any) {
    const authorization = context.switchToHttp().getRequest()
      .headers.authorization;
    if (authorization && (err || !user)) throw new UnauthorizedException();
    return user || undefined;
  }
}

@Controller('video-delivery')
export class VideoDeliveryController {
  constructor(
    private readonly delivery: VideoDeliveryService,
    private readonly cloudflare: CloudflareStreamService,
  ) {}

  @Get('configuration')
  configuration() {
    return { cloudflareEnabled: this.cloudflare.isEnabled() };
  }

  @Get('overview')
  @UseGuards(JwtAuthGuard, DeliveryAdminGuard)
  overview() {
    return this.delivery.overview();
  }

  @Get('source/:id')
  async source(
    @Param('id') id: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Res({ passthrough: true }) res: any,
  ) {
    if (!this.cloudflare.verifySource(id, expires, signature))
      throw new UnauthorizedException('Lien source expiré ou invalide');
    res.setHeader('Cache-Control', 'private, no-store');
    const original = await this.delivery.original(id);
    return new StreamableFile(original.stream, {
      type: original.mimeType,
      length: original.size ?? undefined,
    });
  }

  @Post(':id/retry')
  @UseGuards(JwtAuthGuard, DeliveryAdminGuard)
  retry(@Param('id') id: string) {
    return this.delivery.retry(id);
  }

  @Get('playback/:id')
  @UseGuards(OptionalDeliveryJwtGuard)
  playback(
    @Param('id') id: string,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    res.setHeader('Cache-Control', 'private, no-store');
    return this.delivery.playback(id, req.user);
  }

  @Post('webhook')
  webhook(@Req() req: any, @Headers('webhook-signature') signature?: string) {
    if (
      !this.cloudflare.isEnabled() ||
      !this.cloudflare.verifyWebhook(req.rawBody, signature)
    )
      throw new UnauthorizedException('Signature webhook invalide');
    return this.delivery.receiveWebhook(req.body);
  }
}
