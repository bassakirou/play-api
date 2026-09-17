import { Module } from '@nestjs/common';
import { ShareSettingsService } from './share-settings.service';
import { ShareSettingsController } from './share-settings.controller';

@Module({
  controllers: [ShareSettingsController],
  providers: [ShareSettingsService],
  exports: [ShareSettingsService],
})
export class ShareSettingsModule {}
