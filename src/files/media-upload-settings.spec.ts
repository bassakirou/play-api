import { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { JwtStrategy } from '../auth/jwt.strategy';
import { LegacyMediaGuard } from '../content-access/legacy-media.guard';
import { MediaSourceOwnershipService } from '../content-access/media-source-ownership.service';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { HlsTranscoderService } from '../storage/hls-transcoder.service';
import { MinioService } from '../storage/minio.service';
import { VercelBlobService } from '../storage/vercel-blob.service';
import { FilesController } from './files.controller';
import { MediaUploadSettingsController, MediaUploadSettingsService } from './media-upload-settings';

describe('Media upload limits over HTTP', () => {
  let app: INestApplication;
  let record: Record<string, number> | null = null;
  const storage = jest.fn().mockResolvedValue('https://media.test/images/photo.png');
  const config = { avatarKiB: 16, bannerKiB: 80, imageKiB: 300, audioMiB: 25, videoMiB: 100 };
  const bearer = (sub: string) => 'Bearer ' + sign({ sub, role: 'USER' }, 'fixture-secret');

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [MediaUploadSettingsController, FilesController],
      providers: [
        MediaUploadSettingsService,
        JwtStrategy,
        { provide: ConfigService, useValue: new ConfigService({ JWT_SECRET: 'fixture-secret' }) },
        { provide: PrismaService, useValue: { mediaUploadConfig: {
          findUnique: async () => record,
          upsert: async ({ update }: any) => ({ id: 'default', ...(record = update) }),
        } } },
        { provide: MediaSourceOwnershipService, useValue: { isAdmin: async (id: string) => id === 'admin' } },
        { provide: MinioService, useValue: { isEnabled: () => true, upload: storage } },
        { provide: VercelBlobService, useValue: { isEnabled: () => false } },
        { provide: HlsTranscoderService, useValue: {} },
        { provide: MediaService, useValue: { create: async () => {} } },
      ],
    }).overrideGuard(LegacyMediaGuard).useValue({ canActivate: () => true }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => { await app?.close(); });

  it('uses conservative defaults and validates both administrator permissions and values', async () => {
    await request(app.getHttpServer()).get('/files/upload-limits').expect(200)
      .expect(({ body }) => expect(body.avatarKiB).toBe(300));
    await request(app.getHttpServer()).patch('/files/upload-limits').send(config).expect(401);
    await request(app.getHttpServer()).patch('/files/upload-limits')
      .set('Authorization', bearer('member')).send(config).expect(403);
    await request(app.getHttpServer()).patch('/files/upload-limits')
      .set('Authorization', bearer('admin')).send({ ...config, bannerKiB: 2049 }).expect(400);
    await request(app.getHttpServer()).patch('/files/upload-limits')
      .set('Authorization', bearer('admin')).send(config).expect(200, config);
    await request(app.getHttpServer()).get('/files/upload-limits').expect(200, config);
  });

  it('accepts the exact avatar limit and rejects heavier avatars before storage', async () => {
    record = config;
    const png = (bytes: number, width = 300) => {
      const image = Buffer.alloc(bytes);
      Buffer.from('89504e470d0a1a0a', 'hex').copy(image);
      image.writeUInt32BE(width, 16);
      image.writeUInt32BE(300, 20);
      return image;
    };
    const send = (purpose: string, file: Buffer) => request(app.getHttpServer())
      .post('/files/upload-image?purpose=' + purpose)
      .set('Authorization', bearer('member'))
      .attach('file', file, 'profile.png');
    await send('avatar', png(16 * 1024)).expect(201);
    storage.mockClear();
    await send('avatar', png(16 * 1024 + 1)).expect(413)
      .expect(({ body }) => expect(body.message).toContain('16 Ko'));
    await send('banner', png(16 * 1024, 4097)).expect(400);
    await send('banner', Buffer.alloc(1024)).expect(400);
    expect(storage).not.toHaveBeenCalled();
    await send('banner', png(16 * 1024 + 1)).expect(201);
  });
});
