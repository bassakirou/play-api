import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { LiveSettingsService, UpdateLiveSettingsDto } from './live-settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('lives/config')
export class LiveSettingsController {
  constructor(private readonly liveSettingsService: LiveSettingsService) {}

  @Get()
  getConfig() {
    return this.liveSettingsService.getConfig();
  }

  @UseGuards(JwtAuthGuard)
  @Patch()
  updateConfig(@Request() req: any, @Body() dto: UpdateLiveSettingsDto) {
    const role = (
      typeof req.user?.role === 'object' ? req.user?.role?.name : req.user?.role || ''
    ).toUpperCase();
    const systemRoles = (req.user?.systemRoles || []).map((r: string) => r.toUpperCase());

    const isAdmin =
      role === 'ADMIN' ||
      role === 'SUPER_ADMIN' ||
      systemRoles.includes('ADMIN') ||
      systemRoles.includes('SUPER_ADMIN');

    if (!isAdmin) {
      throw new ForbiddenException('Seuls les administrateurs peuvent modifier les paramètres des lives.');
    }

    return this.liveSettingsService.updateConfig(dto);
  }
}
