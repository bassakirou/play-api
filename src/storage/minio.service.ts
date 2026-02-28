/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { Injectable, Optional } from '@nestjs/common';
import { Client as MinioClient } from 'minio';

export type MinioConfig = {
  endPoint?: string;
  port?: number;
  useSSL?: boolean;
  accessKey?: string;
  secretKey?: string;
  publicUrl?: string;
  buckets?: {
    audio?: string;
    images?: string;
    videos?: string;
  };
};

@Injectable()
export class MinioService {
  private client: MinioClient | null = null;
  private cfg: MinioConfig;

  constructor(@Optional() cfg?: MinioConfig) {
    this.cfg = cfg || {
      endPoint: process.env.MINIO_ENDPOINT,
      port: process.env.MINIO_PORT ? Number(process.env.MINIO_PORT) : undefined,
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
      publicUrl: process.env.MINIO_PUBLIC_URL,
      buckets: {
        audio: process.env.MINIO_BUCKET_AUDIO || 'audio',
        images: process.env.MINIO_BUCKET_IMAGES || 'images',
        videos: process.env.MINIO_BUCKET_VIDEOS || 'videos',
      },
    };
    if (this.cfg.endPoint && this.cfg.accessKey && this.cfg.secretKey) {
      this.client = new MinioClient({
        endPoint: this.cfg.endPoint!,
        port: this.cfg.port,
        useSSL: this.cfg.useSSL,
        accessKey: this.cfg.accessKey!,
        secretKey: this.cfg.secretKey!,
      });
    }
  }

  isEnabled() {
    return !!this.client;
  }

  async ensureBucket(name: string) {
    if (!this.client) return;
    const exists = await this.client.bucketExists(name).catch(() => false);
    if (!exists) {
      await this.client.makeBucket(name).catch(() => undefined);
    }
  }

  async upload(opts: {
    bucket: 'audio' | 'images' | 'videos';
    objectName: string;
    buffer: Buffer;
    contentType?: string;
  }) {
    if (!this.client) {
      throw new Error('MinIO not configured');
    }
    const bucketName =
      (this.cfg.buckets?.[opts.bucket] as string) || opts.bucket;
    await this.ensureBucket(bucketName);
    await this.client.putObject(
      bucketName,
      opts.objectName,
      opts.buffer,
      opts.buffer.length,
      {
        'Content-Type': opts.contentType || 'application/octet-stream',
      },
    );
    return this.presignGet({
      bucket: opts.bucket,
      objectName: opts.objectName,
      contentType: opts.contentType,
    });
  }

  async presignGet(opts: {
    bucket: 'audio' | 'images' | 'videos';
    objectName: string;
    contentType?: string;
    expiresSeconds?: number;
  }) {
    if (!this.client) {
      throw new Error('MinIO not configured');
    }
    const bucketName =
      (this.cfg.buckets?.[opts.bucket] as string) || opts.bucket;
    await this.ensureBucket(bucketName);
    const url = await this.client.presignedGetObject(
      bucketName,
      opts.objectName,
      opts.expiresSeconds ?? 60 * 60 * 24 * 7,
      opts.contentType
        ? { 'response-content-type': opts.contentType }
        : undefined,
    );
    if (this.cfg.publicUrl) {
      const u = new URL(url);
      const publicBase = new URL(this.cfg.publicUrl);
      u.protocol = publicBase.protocol;
      u.host = publicBase.host;
      if (publicBase.port) u.port = publicBase.port;
      return u.toString();
    }
    return url;
  }
}
