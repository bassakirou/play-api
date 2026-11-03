import {
  Body,
  Controller,
  Get,
  INestApplication,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { AcademicSubscriptionService } from './academic-subscription.service';
import { MediaSourceOwnershipService } from './media-source-ownership.service';
import { ContentWriteGuard } from './content-write.guard';
import { CreateSongDto } from '../songs/dto/create-song.dto';
import { CreateAlbumDto } from '../albums/dto/create-album.dto';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { JwtStrategy } from '../auth/jwt.strategy';

@Controller()
class TestController {
  @Post('songs') song(@Body() body: CreateSongDto) {
    return body;
  }
  @Post('albums') album(@Body() body: CreateAlbumDto) {
    return body;
  }
  @Get('academic/courses/course')
  @UseGuards(OptionalJwtAuthGuard)
  detail(@Req() req: any) {
    return { userId: req.user?.id || null };
  }
}

describe('Global content write guard over HTTP', () => {
  let app: INestApplication;
  const bearer = () => `Bearer ${sign({ sub: 'owner' }, 'http-test-key')}`;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [TestController],
      providers: [
        JwtStrategy,
        MediaSourceOwnershipService,
        {
          provide: PrismaService,
          useValue: {
            mediaAsset: { findMany: async () => [{ fileUrl: 'private.mp3' }] },
            user: { findUnique: async () => ({ systemRoles: [] }) },
            artist: {
              findFirst: async () => ({
                id: '4ab320d1-4316-48af-8850-0aa7a7403159',
              }),
            },
          },
        },
        { provide: ConfigService, useValue: { get: () => 'http-test-key' } },
        {
          provide: AcademicSubscriptionService,
          useValue: {
            isAdmin: async () => false,
            assertCanPublish: async () => undefined,
          },
        },
        { provide: APP_GUARD, useClass: ContentWriteGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('blocks a create with no bearer before the controller executes', async () => {
    await request(app.getHttpServer()).post('/songs').send({}).expect(401);
  });
  it('retains song prices through the real whitelist pipe', async () => {
    const result = await request(app.getHttpServer())
      .post('/songs')
      .set('Authorization', bearer())
      .send({
        title: 'Song',
        duration: 10,
        isSingle: true,
        audioUrl: 'private.mp3',
        isMonetized: true,
        price: 500,
        discountPrice: 400,
        ignored: 'drop',
      })
      .expect(201);
    expect(result.body).toEqual(
      expect.objectContaining({
        isMonetized: true,
        price: 500,
        discountPrice: 400,
      }),
    );
    expect(result.body).not.toHaveProperty('ignored');
  });
  it('retains album prices through the real whitelist pipe', async () => {
    const result = await request(app.getHttpServer())
      .post('/albums')
      .set('Authorization', bearer())
      .send({
        title: 'Album',
        year: 2026,
        isMonetized: true,
        price: 900,
        discountPrice: 800,
      })
      .expect(201);
    expect(result.body).toEqual(
      expect.objectContaining({
        isMonetized: true,
        price: 900,
        discountPrice: 800,
      }),
    );
  });
  it('accepts anonymous catalogue identity and verifies an optional JWT', async () => {
    await request(app.getHttpServer())
      .get('/academic/courses/course')
      .expect(200, { userId: null });
    await request(app.getHttpServer())
      .get('/academic/courses/course')
      .set('Authorization', bearer())
      .expect(200, { userId: 'owner' });
    await request(app.getHttpServer())
      .get('/academic/courses/course')
      .set('Authorization', 'Bearer forged')
      .expect(401);
  });
});
