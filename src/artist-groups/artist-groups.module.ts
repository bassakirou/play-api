import { Module } from '@nestjs/common';
import { ArtistGroupsService } from './artist-groups.service';
import { ArtistGroupsController } from './artist-groups.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PassportModule } from '@nestjs/passport';

@Module({
  imports: [PrismaModule, PassportModule],
  controllers: [ArtistGroupsController],
  providers: [ArtistGroupsService],
})
export class ArtistGroupsModule {}
