import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { ContentAccessService } from './content-access.service';
import { ContentAccessController } from './content-access.controller';
import { ContentAccessInterceptor } from './content-access.interceptor';
import { AcademicSubscriptionService } from './academic-subscription.service';
import { ContentWriteGuard } from './content-write.guard';
import { LegacyMediaGuard } from './legacy-media.guard';
import { MediaSourceOwnershipService } from './media-source-ownership.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    ContentAccessService,
    AcademicSubscriptionService,
    MediaSourceOwnershipService,
    LegacyMediaGuard,
    { provide: APP_GUARD, useClass: ContentWriteGuard },
    { provide: APP_INTERCEPTOR, useClass: ContentAccessInterceptor },
  ],
  controllers: [ContentAccessController],
  exports: [
    ContentAccessService,
    LegacyMediaGuard,
    MediaSourceOwnershipService,
  ],
})
export class ContentAccessModule {}
