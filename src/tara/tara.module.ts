import { Module } from '@nestjs/common';
import { TaraService } from './tara.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [TaraService],
  exports: [TaraService],
})
export class TaraModule {}
