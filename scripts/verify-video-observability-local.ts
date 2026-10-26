/** Isolated HTTP + PostgreSQL + MinIO health checks. Never loads production .env. */
import 'reflect-metadata';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { parse } from 'dotenv';
import { randomUUID, createHmac } from 'crypto';
import { strict as assert } from 'assert';

async function main() {
  const apiRoot = resolve(__dirname, '..');
  process.chdir(apiRoot);
  Object.assign(
    process.env,
    parse(readFileSync(resolve(apiRoot, '.env.local'))),
  );
  assert(
    ['localhost', '127.0.0.1', '[::1]'].includes(
      new URL(process.env.DATABASE_URL!).hostname,
    ),
  );
  assert(
    ['localhost', '127.0.0.1', '::1'].includes(process.env.MINIO_ENDPOINT!),
  );
  const marker = `monitor-${randomUUID()}`;
  Object.assign(process.env, {
    VIDEO_DELIVERY_PROVIDER: 'minio',
    CLOUDFLARE_ACCOUNT_ID: '',
    MONITORING_ENABLED: 'false',
    MONITOR_HOST_ID: marker,
    MONITOR_EXTERNAL_PROBE_SECRET: randomUUID(),
  });
  const { Test } = require('@nestjs/testing');
  const { ValidationPipe } = require('@nestjs/common');
  const { ConfigService } = require('@nestjs/config');
  const { PassportModule } = require('@nestjs/passport');
  const { JwtStrategy } = require('../src/auth/jwt.strategy');
  const { PrismaService } = require('../src/prisma/prisma.service');
  const { MinioService } = require('../src/storage/minio.service');
  const {
    VideoDeliveryService,
  } = require('../src/video-delivery/video-delivery.service');
  const {
    CloudflareStreamService,
  } = require('../src/video-delivery/cloudflare-stream.service');
  const {
    VideoObservabilityController,
  } = require('../src/video-observability/video-observability.controller');
  const {
    VideoSessionService,
  } = require('../src/video-observability/video-session.service');
  const {
    VideoMonitorService,
  } = require('../src/video-observability/video-monitor.service');
  const {
    HostMetricsService,
  } = require('../src/video-observability/host-metrics.service');
  const {
    CloudflareUsageService,
  } = require('../src/video-observability/cloudflare-usage.service');
  const {
    ExternalProbeService,
  } = require('../src/video-observability/external-probe.service');
  const jwt = require('jsonwebtoken');
  let app: any, db: any, video: any, paid: any;
  try {
    const config = new ConfigService(process.env);
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [VideoObservabilityController],
      providers: [
        PrismaService,
        JwtStrategy,
        VideoSessionService,
        VideoMonitorService,
        HostMetricsService,
        CloudflareUsageService,
        ExternalProbeService,
        VideoDeliveryService,
        CloudflareStreamService,
        { provide: ConfigService, useValue: config },
        { provide: MinioService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication({ rawBody: true, logger: false });
    app.set('trust proxy', 'loopback');
    app.enableCors({ origin: 'http://127.0.0.1:5197' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    db = app.get(PrismaService);
    const base = await app.getUrl();
    const token = (role: string) =>
      jwt.sign(
        { sub: randomUUID(), role },
        process.env.JWT_SECRET || 'secretKey',
        { expiresIn: '10m' },
      );
    const admin = token('ADMIN'),
      creator = token('CREATOR');
    const request = async (
      path: string,
      data?: any,
      auth?: string,
      extra = {},
    ) => {
      const response = await fetch(base + '/video-observability' + path, {
        method: data ? 'POST' : 'GET',
        headers: {
          ...(data ? { 'Content-Type': 'application/json' } : {}),
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
          ...extra,
        },
        body: data ? JSON.stringify(data) : undefined,
      });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await request('/overview')).status, 401);
    assert.equal((await request('/overview', undefined, creator)).status, 403);
    video = await db.video.create({
      data: {
        title: marker,
        videoUrl: 'http://127.0.0.1/fixture.mp4',
        duration: 120,
        isPublished: true,
      },
    });
    paid = await db.video.create({
      data: {
        title: marker,
        videoUrl: 'http://127.0.0.1/fixture.mp4',
        duration: 120,
        isPublished: true,
        isMonetized: true,
        price: 100,
      },
    });
    assert.equal(
      (await request('/sessions', { videoId: paid.id })).status,
      403,
    );
    assert.equal((await request('/sessions', { videoId: 'bad' })).status, 400);
    const start = await request('/sessions', { videoId: video.id });
    assert.equal(start.status, 201);
    const pulse = {
      token: start.body.token,
      sequence: 1,
      cumulativePlayedSeconds: 0,
      bufferSeconds: 0,
      stalls: 0,
      errors: 0,
      playing: true,
      ended: false,
    };
    assert.equal(
      (
        await request(`/sessions/${start.body.id}/pulse`, {
          ...pulse,
          token: '0'.repeat(64),
        })
      ).status,
      401,
    );
    assert.equal(
      (await request(`/sessions/${start.body.id}/pulse`, pulse)).body.accepted,
      true,
    );
    assert.equal(
      (await request(`/sessions/${start.body.id}/pulse`, pulse)).body.accepted,
      false,
    );
    const sessions = app.get(VideoSessionService);
    assert(
      (await sessions.summary(new Date(Date.now() - 60_000))).activeSessions >=
        1,
    );
    await request(`/sessions/${start.body.id}/pulse`, {
      ...pulse,
      sequence: 2,
      playing: false,
      ended: true,
    });
    assert.equal(
      (
        await db.videoPlaybackSession.findUnique({
          where: { id: start.body.id },
        })
      ).playing,
      false,
    );
    // Enable one explicit real sample; no scheduler is installed in this isolated module.
    config.set('MONITORING_ENABLED', 'true');
    const monitor = app.get(VideoMonitorService);
    await monitor.sample();
    const overview = await request(
      `/overview?range=1h&host=${marker}`,
      undefined,
      admin,
    );
    assert.equal(overview.status, 200);
    assert.equal(overview.body.hostId, marker);
    assert.equal(overview.body.latest.databaseOk, true);
    assert.equal(overview.body.latest.minioOk, true);
    assert(overview.body.latest.nodeRssBytes > 0);
    assert(overview.body.history.length > 0);
    assert.equal(overview.body.cloudflare.state, 'unconfigured');
    assert.equal(overview.body.cloudflare.totalUsd, null);
    await monitor.setAlert(marker, true, 'warning', 'Local fixture');
    const alert = await db.videoMonitorAlert.findUnique({
      where: { key: marker },
    });
    assert.equal(
      (await request(`/alerts/${alert.id}/ack`, {}, creator)).status,
      403,
    );
    assert.equal(
      (await request(`/alerts/${alert.id}/ack`, {}, admin)).status,
      201,
    );
    const report = {
      probeId: marker,
      observedAt: new Date().toISOString(),
      status: 'up',
      latencyMs: 12,
    };
    assert.equal((await request('/probe', report)).status, 401);
    const signature = createHmac(
      'sha256',
      process.env.MONITOR_EXTERNAL_PROBE_SECRET!,
    )
      .update(JSON.stringify(report))
      .digest('hex');
    assert.equal(
      (
        await request('/probe', report, undefined, {
          'X-Probe-Signature': signature,
        })
      ).status,
      201,
    );
    await request('/probe', report, undefined, {
      'X-Probe-Signature': signature,
    });
    assert.equal(
      await db.videoExternalProbe.count({ where: { probeId: marker } }),
      1,
    );
    // Two forwarded visitors each have their own quota behind the trusted local proxy.
    for (let i = 0; i < 12; i++)
      for (const ip of ['198.51.100.1', '198.51.100.2'])
        assert.equal(
          (
            await request('/sessions', { videoId: video.id }, undefined, {
              'X-Forwarded-For': ip,
            })
          ).status,
          201,
        );
    console.log(
      'PASS real PostgreSQL HTTP: admin guards, access policy, validated pulses/replay/end, real host/DB/MinIO sample, SQL history, alert acknowledgement, Cloudflare unknown costs, signed deduplicated probe, distinct proxy clients.',
    );
    if (process.argv.includes('--serve-ui')) {
      const context = resolve(tmpdir(), 'pyramidplay-monitor-ui.json');
      writeFileSync(context, JSON.stringify({ base, token: admin }), {
        mode: 0o600,
      });
      console.log(
        'Temporary UI fixture ready on loopback; remove temporary context to finish (3 minute limit).',
      );
      await new Promise<void>((done) => {
        const start = Date.now();
        const interval = setInterval(() => {
          if (!existsSync(context) || Date.now() - start > 180_000) {
            clearInterval(interval);
            done();
          }
        }, 500);
      });
      if (existsSync(context)) unlinkSync(context);
    }
  } finally {
    if (db) {
      await db.video.deleteMany({
        where: { id: { in: [video?.id, paid?.id].filter(Boolean) } },
      });
      await db.videoMonitorSample.deleteMany({ where: { hostId: marker } });
      await db.videoMonitorAlert.deleteMany({
        where: {
          OR: [{ key: marker }, { key: { startsWith: `host:${marker}:` } }],
        },
      });
      await db.videoExternalProbe.deleteMany({ where: { probeId: marker } });
    }
    if (app) await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
