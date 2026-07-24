/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
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
export class MinioService implements OnModuleInit {
  private client: MinioClient | null = null;
  private presignClient: MinioClient | null = null;
  private cfg: MinioConfig;
  /** Track buckets whose policies have already been set this process lifetime */
  private policyApplied = new Set<string>();

  constructor(@Optional() cfg?: MinioConfig) {
    this.cfg = cfg || {
      endPoint: process.env.MINIO_ENDPOINT || '127.0.0.1',
      port: process.env.MINIO_PORT ? Number(process.env.MINIO_PORT) : 9000,
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'admin',
      secretKey: process.env.MINIO_SECRET_KEY || 'admin123',
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
        const isHttps = publicBase.protocol === 'https:';
        const port = publicBase.port
          ? Number(publicBase.port)
          : isHttps
            ? 443
            : (this.cfg.port || 80);

        this.presignClient = new MinioClient({
          endPoint: publicBase.hostname,
          port,
          useSSL: isHttps,
          accessKey: this.cfg.accessKey!,
          secretKey: this.cfg.secretKey!,
        });
      } catch {
        this.presignClient = null;
      }
    }
  }

  /**
   * On API startup, list ALL existing MinIO buckets and apply
   * a public-read policy to each one.  This is the definitive fix
   * for old buckets (play-audio, play-videos, etc.) that were
   * created without a public policy.
   */
  async onModuleInit() {
    if (!this.client) return;
    try {
      console.log('[MinioService] onModuleInit – fixing policies for ALL existing buckets …');
      const buckets = await this.client.listBuckets();
      for (const b of buckets) {
        await this.ensureBucketPolicy(b.name);
      }
      console.log(
        `[MinioService] onModuleInit – policies applied to ${buckets.length} bucket(s): ${buckets.map((b) => b.name).join(', ')}`,
      );
    } catch (err) {
      console.error('[MinioService] onModuleInit – failed to list/fix buckets:', err.message);
    }
  }

  isEnabled() {
    return !!this.client;
  }

  /**
   * Apply a public-read S3 policy to a bucket (idempotent – skips
   * if already applied during this process lifetime).
   */
  private async ensureBucketPolicy(name: string) {
    if (!this.client) return;
    if (this.policyApplied.has(name)) return;
    try {
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
      this.policyApplied.add(name);
      console.log(`[MinioService] Public-read policy applied to bucket "${name}"`);
    } catch (err) {
      console.warn(`[MinioService] Could not set policy on bucket "${name}":`, err.message);
    }
  }

  async ensureBucket(name: string) {
    if (!this.client) return;
    try {
      const exists = await this.client.bucketExists(name);
      if (!exists) {
        console.log(`[MinioService] Creating bucket: ${name}`);
        await this.client.makeBucket(name, 'us-east-1');
      }
      // Ensure public read policy so browser audio/video elements and HLS streams can access files without 403
      await this.ensureBucketPolicy(name);
    } catch (error) {
      console.error(
        `[MinioService] Error ensuring bucket ${name}:`,
        error.message,
      );
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

    const publicUrl =
      process.env.MINIO_PUBLIC_URL ||
      (process.env.NODE_ENV === 'production' || !!process.env.VERCEL
        ? 'https://media.pyramidplay.cm'
        : 'http://localhost:9000');

    return `${publicUrl}/${bucketName}/${opts.objectName}`;
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

  async getObjectStream(
    bucket: string,
    objectName: string,
  ): Promise<{ stream: any; stat?: any }> {
    if (!this.client) {
      throw new Error('MinIO not configured');
    }
    const rawBucket = bucket || 'audio';
    const candidateBuckets = [
      (this.cfg.buckets?.[rawBucket as any] as string) || rawBucket,
      rawBucket,
      rawBucket.replace(/^play-/, ''),
      `play-${rawBucket.replace(/^play-/, '')}`,
    ].filter((b, i, a) => b && a.indexOf(b) === i);

    const strippedObj = objectName.replace(/^hls\//, '');
    const candidateObjects = [
      objectName,
      strippedObj,
      `hls/${strippedObj}`,
    ].filter((o, i, a) => o && a.indexOf(o) === i);

    console.log(
      `[getObjectStream] Searching for object "${objectName}" — candidate buckets: [${candidateBuckets.join(', ')}], candidate objects: [${candidateObjects.join(', ')}]`,
    );

    // Ensure public-read policies on all candidate buckets before trying
    for (const b of candidateBuckets) {
      try {
        const exists = await this.client.bucketExists(b);
        if (exists) {
          await this.ensureBucketPolicy(b);
        }
      } catch { /* bucket does not exist, skip */ }
    }

    let lastError: any = null;
    for (const b of candidateBuckets) {
      for (const obj of candidateObjects) {
        try {
          const stat = await this.client.statObject(b, obj);
          console.log(`[getObjectStream] statObject OK: bucket="${b}", object="${obj}", size=${stat?.size}`);
          const stream = await this.client.getObject(b, obj);
          console.log(`[getObjectStream] ✓ Streaming "${obj}" from bucket "${b}"`);
          return { stream, stat };
        } catch (err) {
          console.log(`[getObjectStream] ✗ bucket="${b}", object="${obj}" → ${err.code || err.message}`);
          lastError = err;
        }
      }
    }
    console.error(
      `[getObjectStream] FAILED: object "${objectName}" not found in any candidate bucket/object combination`,
    );
    throw lastError || new Error(`Object ${objectName} not found in buckets: ${candidateBuckets.join(', ')}`);
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
