/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { Injectable, Optional } from '@nestjs/common';
import { Client as MinioClient } from 'minio';
import { Buffer } from 'buffer';

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
  private presignClient: MinioClient | null = null;
  private cfg: MinioConfig;

  constructor(@Optional() cfg?: MinioConfig) {
    this.cfg = cfg || {
      endPoint: process.env.MINIO_ENDPOINT,
      port: process.env.MINIO_PORT ? Number(process.env.MINIO_PORT) : undefined,
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
      publicUrl:
        process.env.MINIO_PUBLIC_URL ||
        (process.env.NODE_ENV === 'production' || !!process.env.VERCEL
          ? 'https://media.pyramidplay.cm'
          : 'http://localhost:9000'),
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

    if (this.client && this.cfg.publicUrl) {
      try {
        const publicBase = new URL(this.cfg.publicUrl);
        this.presignClient = new MinioClient({
          endPoint: publicBase.hostname,
          port: publicBase.port ? Number(publicBase.port) : this.cfg.port,
          useSSL: publicBase.protocol === 'https:',
          accessKey: this.cfg.accessKey!,
          secretKey: this.cfg.secretKey!,
        });
      } catch {
        this.presignClient = null;
      }
    }
  }

  isEnabled() {
    return !!this.client;
  }

  async ensureBucket(name: string) {
    if (!this.client) return;
    try {
      const exists = await this.client.bucketExists(name);
      if (!exists) {
        console.log(`[MinioService] Creating bucket: ${name}`);
        await this.client.makeBucket(name, 'us-east-1'); // Region is often needed
      }
      // Ensure public read policy so browser audio/video elements and HLS streams can access files without 403
      const policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${name}/*`],
          },
        ],
      };
      await this.client.setBucketPolicy(name, JSON.stringify(policy));
    } catch (error) {
      console.error(
        `[MinioService] Error ensuring bucket ${name}:`,
        error.message,
      );
      // We don't throw here to allow the upload to attempt, but it's a red flag
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
    try {
      await this.client.putObject(
        bucketName,
        opts.objectName,
        opts.buffer,
        opts.buffer.length,
        {
          'Content-Type': opts.contentType || 'application/octet-stream',
        },
      );
      console.log(`[MinioService] Upload successful: ${opts.objectName}`);
    } catch (error) {
      console.error(`[MinioService] CRITICAL UPLOAD ERROR:`, {
        message: error.message,
        code: error.code,
        bucket: bucketName,
        endpoint: process.env.MINIO_ENDPOINT,
      });
      throw error;
    }
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
    const client = this.presignClient || this.client;
    const responseHeaders =
      opts.contentType && !opts.contentType.includes('*')
        ? { 'response-content-type': opts.contentType }
        : undefined;
    const url = await client.presignedGetObject(
      bucketName,
      opts.objectName,
      opts.expiresSeconds ?? 60 * 60 * 24 * 7,
      responseHeaders,
    );
    return url;
  }

  refreshUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    const isProduction =
      process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
    const defaultPublicUrl = isProduction
      ? 'https://media.pyramidplay.cm'
      : 'http://localhost:9000';
    const publicUrl = (
      process.env.MINIO_PUBLIC_URL || defaultPublicUrl
    ).replace(/\/+$/, '');
    return url
      .replace('https://media.pyramidplay.cm', publicUrl)
      .replace('http://localhost:9000', publicUrl)
      .replace('http://127.0.0.1:9000', publicUrl);
  }
}
