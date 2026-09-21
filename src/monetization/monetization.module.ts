import { Module } from '@nestjs/common';
import { MonetizationController } from './monetization.controller';
import { MonetizationService } from './monetization.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TaraModule } from '../tara/tara.module';

@Module({
  imports: [PrismaModule, TaraModule],
  controllers: [MonetizationController],
  providers: [MonetizationService],
  exports: [MonetizationService],
})
export class MonetizationModule {}
