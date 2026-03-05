import { Global, Module } from '@nestjs/common';
import { MinioService } from './minio.service';
import { VercelBlobService } from './vercel-blob.service';

@Global()
@Module({
  providers: [MinioService, VercelBlobService],
  exports: [MinioService, VercelBlobService],
})
export class StorageModule {}
