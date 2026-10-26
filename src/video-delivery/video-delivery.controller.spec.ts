import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac } from 'crypto';
import { Readable } from 'stream';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { JwtStrategy } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../storage/minio.service';
import { CloudflareStreamService } from './cloudflare-stream.service';
import { VideoDeliveryService } from './video-delivery.service';
import {
  VideoDeliveryController,
  DeliveryAdminGuard,
  OptionalDeliveryJwtGuard,
} from './video-delivery.controller';

describe('Delivery HTTP contract', () => {
  let app: NestExpressApplication;
  const config = new ConfigService({
    JWT_SECRET: 'unit-test-secret',
    VIDEO_DELIVERY_PROVIDER: 'cloudflare',
    CLOUDFLARE_ACCOUNT_ID: 'test-account',
    CLOUDFLARE_STREAM_API_TOKEN: 'test-token',
    CLOUDFLARE_STREAM_CUSTOMER_CODE: 'customer-test',
    CLOUDFLARE_STREAM_WEBHOOK_SECRET: 'webhook-secret',
    VIDEO_DELIVERY_ORIGIN_URL: 'https://api.test.local',
  });
  const token = (role: string) =>
    sign({ sub: 'test-user', role }, 'unit-test-secret', { expiresIn: '5m' });
  beforeAll(async () => {
    const provider = new CloudflareStreamService(config);
    jest
      .spyOn(provider, 'playback')
      .mockResolvedValue({
        url: 'https://customer-test.cloudflarestream.com/signed-token/manifest/video.m3u8',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });
    const db = {
      mediaAsset: { findUnique: async () => ({ id: 'asset-1', type: 'video', originalBucket: 'videos', originalObject: 'original.mp4', mimeType: 'video/mp4', size: 16 }) },
      videoDelivery: {
        groupBy: async () => [],
        findMany: async () => [],
        findUnique: async () => null,
      },
      video: {
        findUnique: async () => ({
          id: 'video-1',
          userId: 'creator',
          isPublished: true,
          isMonetized: false,
          mediaAsset: { delivery: { remoteUid: 'remote-id', status: 'READY' } },
        }),
      },
    };
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [VideoDeliveryController],
      providers: [
        VideoDeliveryService,
        DeliveryAdminGuard,
        OptionalDeliveryJwtGuard,
        JwtStrategy,
        { provide: ConfigService, useValue: config },
        { provide: CloudflareStreamService, useValue: provider },
        { provide: PrismaService, useValue: db },
        { provide: MinioService, useValue: { getBucketName: () => 'videos', readVideoOriginal: async () => ({ stream: Readable.from(Buffer.from('original-fixture')), stat: { size: 16 } }) } },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    app.useBodyParser('json', { limit: '100mb' });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('requires an admin role for operations and keeps configuration secrets out of responses', async () => {
    await request(app.getHttpServer())
      .get('/video-delivery/overview')
      .expect(401);
    await request(app.getHttpServer())
      .get('/video-delivery/overview')
      .set('Authorization', `Bearer ${token('USER')}`)
      .expect(403);
    const response = await request(app.getHttpServer())
      .get('/video-delivery/overview')
      .set('Authorization', `Bearer ${token('ADMIN')}`)
      .expect(200);
    expect(response.body.configuration.configured).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('test-token');
    await request(app.getHttpServer())
      .post('/video-delivery/job-1/retry')
      .set('Authorization', `Bearer ${token('USER')}`)
      .expect(403);
  });

  it('allows anonymous public playback, rejects a forged JWT and does not cache signed responses', async () => {
    const response = await request(app.getHttpServer())
      .get('/video-delivery/playback/video-1')
      .expect(200);
    expect(response.body.url).toContain(
      'cloudflarestream.com/signed-token/manifest/video.m3u8',
    );
    expect(response.headers['cache-control']).toBe('private, no-store');
    await request(app.getHttpServer())
      .get('/video-delivery/playback/video-1')
      .set('Authorization', 'Bearer forged')
      .expect(401);
  });

  it('verifies the exact incoming webhook bytes including whitespace and newlines', async () => {
    const body = '{ "uid": "remote-id" }\n';
    const time = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', 'webhook-secret')
      .update(`${time}.${body}`)
      .digest('hex');
    await request(app.getHttpServer())
      .post('/video-delivery/webhook')
      .set('Content-Type', 'application/json')
      .set('Webhook-Signature', `time=${time},sig1=${signature}`)
      .send(body)
      .expect(201, { received: true });
    await request(app.getHttpServer())
      .post('/video-delivery/webhook')
      .set('Content-Type', 'application/json')
      .set('Webhook-Signature', `time=${time},sig1=${signature}`)
      .send('{"uid":"remote-id"}')
      .expect(401);
  });

  it('streams the retained original only through its valid signed source link', async () => {
    const provider = new CloudflareStreamService(config);
    const signed = new URL(provider.sourceUrl('asset-1'));
    const response = await request(app.getHttpServer()).get(`${signed.pathname}${signed.search}`).expect(200);
    expect(response.body.toString()).toBe('original-fixture');
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('does not expose an original without a valid scoped temporary signature', async () => {
    await request(app.getHttpServer())
      .get('/video-delivery/source/asset-1')
      .expect(401);
    const provider = new CloudflareStreamService(config);
    const signed = new URL(provider.sourceUrl('asset-1'));
    await request(app.getHttpServer())
      .get(`/video-delivery/source/asset-2${signed.search}`)
      .expect(401);
  });
});
