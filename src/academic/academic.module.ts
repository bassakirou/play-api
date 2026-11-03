import { AcademicSubscriptionService } from '../content-access/academic-subscription.service';
import { Module } from '@nestjs/common';
import { AcademicController } from './academic.controller';
import { AcademicService } from './academic.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AcademicController],
  providers: [AcademicService, AcademicSubscriptionService],
  exports: [AcademicService, AcademicSubscriptionService],
})
export class AcademicModule {}
