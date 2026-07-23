import { Global, Module } from '@nestjs/common';
import { MinioService } from './minio.service';
import { VercelBlobService } from './vercel-blob.service';
import { HlsTranscoderService } from './hls-transcoder.service';

@Global()
@Module({
  providers: [MinioService, VercelBlobService, HlsTranscoderService],
  exports: [MinioService, VercelBlobService, HlsTranscoderService],
})
export class StorageModule {}
