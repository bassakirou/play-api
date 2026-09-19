import { Module } from '@nestjs/common';
import { LivesService } from './lives.service';
import { LivesController } from './lives.controller';
import { LivesGateway } from './lives.gateway';
import { LiveCleanupService } from './live-cleanup.service';
import { LiveSettingsService } from './live-settings.service';
import { LiveSettingsController } from './live-settings.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [LivesController, LiveSettingsController],
  providers: [LivesService, LivesGateway, LiveCleanupService, LiveSettingsService],
  exports: [LivesService, LivesGateway, LiveSettingsService],
})
export class LivesModule {}

