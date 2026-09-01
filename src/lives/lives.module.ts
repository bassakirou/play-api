import { Module } from '@nestjs/common';
import { LivesService } from './lives.service';
import { LivesController } from './lives.controller';
import { LivesGateway } from './lives.gateway';
import { LiveCleanupService } from './live-cleanup.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [LivesController],
  providers: [LivesService, LivesGateway, LiveCleanupService],
  exports: [LivesService, LivesGateway],
})
export class LivesModule {}
