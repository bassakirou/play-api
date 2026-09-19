import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface UpdateLiveSettingsDto {
  maxDurationMinutes?: number;
  maxViewers?: number;
  enableRetention0Days?: boolean;
  enableRetention3Days?: boolean;
  enableRetention7Days?: boolean;
}

@Injectable()
export class LiveSettingsService {
  private readonly logger = new Logger(LiveSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getConfig() {
    try {
      let config = await (this.prisma as any).liveSettingsConfig.findUnique({
        where: { id: 'default' },
      });
      if (!config) {
        config = await (this.prisma as any).liveSettingsConfig.create({
          data: {
            id: 'default',
            maxDurationMinutes: 60,
            maxViewers: 500,
            enableRetention0Days: true,
            enableRetention3Days: true,
            enableRetention7Days: true,
          },
        });
      }
      return config;
    } catch (err: any) {
      this.logger.warn(`[LiveSettingsService] Fallback config: ${err.message}`);
      return {
        id: 'default',
        maxDurationMinutes: 60,
        maxViewers: 500,
        enableRetention0Days: true,
        enableRetention3Days: true,
        enableRetention7Days: true,
      };
    }
  }

  async updateConfig(dto: UpdateLiveSettingsDto) {
    await this.getConfig();

    const updated = await (this.prisma as any).liveSettingsConfig.update({
      where: { id: 'default' },
      data: {
        ...(dto.maxDurationMinutes !== undefined && { maxDurationMinutes: Number(dto.maxDurationMinutes) }),
        ...(dto.maxViewers !== undefined && { maxViewers: Number(dto.maxViewers) }),
        ...(dto.enableRetention0Days !== undefined && { enableRetention0Days: Boolean(dto.enableRetention0Days) }),
        ...(dto.enableRetention3Days !== undefined && { enableRetention3Days: Boolean(dto.enableRetention3Days) }),
        ...(dto.enableRetention7Days !== undefined && { enableRetention7Days: Boolean(dto.enableRetention7Days) }),
      },
    });

    return updated;
  }
}
