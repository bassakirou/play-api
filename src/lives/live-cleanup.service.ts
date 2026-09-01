import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LivesService } from './lives.service';

@Injectable()
export class LiveCleanupService {
  private readonly logger = new Logger(LiveCleanupService.name);

  constructor(private readonly livesService: LivesService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourlyCleanup() {
    this.logger.log('[LiveCleanupService] Exécution de la purge automatique des lives expirés...');
    const result = await this.livesService.cleanupExpiredLives();
    this.logger.log(`[LiveCleanupService] Purge terminée : ${result.cleanedCount} live(s) nettoyé(s).`);
  }
}
