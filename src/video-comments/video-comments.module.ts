import { Module } from '@nestjs/common';
import { VideoCommentsService } from './video-comments.service';
import { VideoCommentsController } from './video-comments.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [VideoCommentsController],
  providers: [VideoCommentsService],
  exports: [VideoCommentsService],
})
export class VideoCommentsModule {}
