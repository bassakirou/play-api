import { Module } from '@nestjs/common';
import { MaintenanceSubscriptionsController } from './maintenance-subscriptions.controller';
import { MaintenanceSubscriptionsService } from './maintenance-subscriptions.service';

@Module({
  controllers: [MaintenanceSubscriptionsController],
  providers: [MaintenanceSubscriptionsService],
})
export class MaintenanceSubscriptionsModule {}
