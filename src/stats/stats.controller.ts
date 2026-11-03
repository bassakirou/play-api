import { Controller, Get, UseGuards, Request, Header } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StatsService } from './stats.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('stats')
@Controller('stats')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('creator')
  @Header('Cache-Control', 'private, no-store')
  async getCreatorStats(@Request() req: any) {
    return this.statsService.getCreatorStats(req.user.id);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Obtenir les statistiques en temps réel pour le Dashboard Admin' })
  async getDashboardStats() {
    return this.statsService.getDashboardStats();
  }
}
