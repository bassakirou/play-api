import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from '../auth/jwt.strategy';
import { VideoObservabilityController } from './video-observability.controller';
import { VideoMonitorService } from './video-monitor.service';
import { VideoSessionService } from './video-session.service';
import { ExternalProbeService } from './external-probe.service';
const request = require('supertest');
const jwt = require('jsonwebtoken');

describe('Administration alert notifications', () => {
  let app: any;
  const alerts = jest.fn(async () => ({
    activeCount: 103,
    items: [
      { id: 'alert', severity: 'critical', message: 'Disk threshold reached' },
    ],
  }));
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [VideoObservabilityController],
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: new ConfigService({ JWT_SECRET: 'local-monitor-test' }),
        },
        { provide: VideoMonitorService, useValue: { alerts } },
        { provide: VideoSessionService, useValue: {} },
        { provide: ExternalProbeService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
  });
  afterAll(async () => app.close());
  it('rejects anonymous and creator access to operational alerts', async () => {
    await request(app.getHttpServer())
      .get('/video-observability/alerts')
      .expect(401);
    const token = jwt.sign(
      { sub: 'creator', role: 'CREATOR' },
      'local-monitor-test',
    );
    await request(app.getHttpServer())
      .get('/video-observability/alerts')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(alerts).not.toHaveBeenCalled();
  });
  it.each(['ADMIN', 'SUPER_ADMIN'])(
    'returns the total count without HTTP caching to %s',
    async (role) => {
      const token = jwt.sign(
        { sub: 'administrator', role },
        'local-monitor-test',
      );
      const response = await request(app.getHttpServer())
        .get('/video-observability/alerts')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.body.activeCount).toBe(103);
      expect(response.body.items).toHaveLength(1);
    },
  );
});
