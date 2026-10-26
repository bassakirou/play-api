/** Real Cloudflare VOD smoke test. Run from play-api with .env.local only.
 * Requires the official cloudflared executable in CLOUDFLARED_PATH or the temp
 * path used by our setup. Creates synthetic content, isolates local fixtures,
 * exposes only their signed source and authenticated webhook, then cleans up.
 * Does not change .env.local, production, existing webhooks or existing videos.
 */
import 'reflect-metadata';
import { strict as assert } from 'assert';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { randomBytes, randomUUID } from 'crypto';
import { execFileSync, spawn } from 'child_process';
import { createServer, request as httpRequest } from 'http';
import { parse } from 'dotenv';

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function main() {
  const root = resolve(__dirname, '..');
  process.chdir(root);
  Object.assign(process.env, parse(readFileSync(join(root, '.env.local'))));
  assert(
    ['localhost', '127.0.0.1', '[::1]'].includes(
      new URL(process.env.DATABASE_URL!).hostname,
    ),
    'Local DB required',
  );
  assert(
    ['localhost', '127.0.0.1', '::1'].includes(process.env.MINIO_ENDPOINT!),
    'Local MinIO required',
  );
  const marker = `cf-local-${randomUUID()}`;
  process.env.NODE_ENV = 'test';
  process.env.BLOB_READ_WRITE_TOKEN = '';
  process.env.VIDEO_DELIVERY_PROVIDER = 'minio';
  process.env.MINIO_BUCKET_VIDEOS = marker + '-videos';
  process.env.MINIO_BUCKET_IMAGES = marker + '-images';
  const account = process.env.CLOUDFLARE_ACCOUNT_ID!;
  const token = process.env.CLOUDFLARE_STREAM_API_TOKEN!;
  assert(
    /^[a-f0-9]{32}$/i.test(account) && token,
    'Cloudflare credentials required',
  );
  const originalFetch = global.fetch;
  global.fetch = async (input: any, options?: any) => {
    const response = await originalFetch(input, options);
    if (String(input).endsWith('/stream/copy') && !response.ok) {
      const body = (await response
        .clone()
        .json()
        .catch(() => ({}))) as any;
      let diagnostic = JSON.stringify({
        http: response.status,
        errors: body.errors,
        messages: body.messages,
      });
      for (const secret of [
        token,
        process.env.CLOUDFLARE_STREAM_ANALYTICS_TOKEN,
      ])
        if (secret) diagnostic = diagnostic.replaceAll(secret, '[masked]');
      console.log(
        'Copy diagnostic: ' +
          diagnostic.replace(/https?:[^"\s]+/g, '[URL masked]'),
      );
    }
    return response;
  };
  const api = async (
    path: string,
    method = 'GET',
    body?: unknown,
    missing = false,
  ) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${account}/stream${path}`,
          {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(20_000),
          },
        );
        if ((missing || method === 'DELETE') && r.status === 404) return null;
        const text = await r.text();
        // Stream deletion can succeed with an empty response body.
        if (method === 'DELETE' && r.ok && !text.trim()) return null;
        const j = JSON.parse(text) as any;
        assert(
          r.ok && j.success,
          `Cloudflare ${method} ${path.split('?')[0]} HTTP ${r.status}`,
        );
        return j.result;
      } catch (error) {
        if (!['GET', 'DELETE'].includes(method) || attempt >= 2) throw error;
        await wait(1000);
      }
    }
  };
  // Never redirect an existing notification subscription, even for a local test.
  const existingHook = await api('/webhook', 'GET', undefined, true);
  assert(
    !existingHook?.notificationUrl,
    'An existing webhook must be preserved; use a separate test account',
  );
  const { Test } = require('@nestjs/testing');
  const { ValidationPipe } = require('@nestjs/common');
  const { ConfigService } = require('@nestjs/config');
  const { PassportModule } = require('@nestjs/passport');
  const { PrismaService } = require('../src/prisma/prisma.service');
  const { MinioService } = require('../src/storage/minio.service');
  const { VercelBlobService } = require('../src/storage/vercel-blob.service');
  const {
    HlsTranscoderService,
  } = require('../src/storage/hls-transcoder.service');
  const { MediaService } = require('../src/media/media.service');
  const { FilesController } = require('../src/files/files.controller');
  const { VideosService } = require('../src/videos/videos.service');
  const { VideosController } = require('../src/videos/videos.controller');
  const {
    VideoDeliveryService,
  } = require('../src/video-delivery/video-delivery.service');
  const {
    VideoDeliveryController,
  } = require('../src/video-delivery/video-delivery.controller');
  const {
    CloudflareStreamService,
  } = require('../src/video-delivery/cloudflare-stream.service');
  const { JwtStrategy } = require('../src/auth/jwt.strategy');
  const { PermissionsGuard } = require('../src/auth/permissions.guard');
  const { Client } = require('minio');
  const jwt = require('jsonwebtoken');
  const storage = new MinioService();
  storage.onModuleInit = async () => {};
  const minio = new Client({
    endPoint: process.env.MINIO_ENDPOINT,
    port: Number(process.env.MINIO_PORT || 9000),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY,
    secretKey: process.env.MINIO_SECRET_KEY,
  });
  const temp = mkdtempSync(join(tmpdir(), 'pyramidplay-cf-check-'));
  const sources = new Set<string>();
  let app: any,
    db: any,
    relay: any,
    tunnel: any,
    user: any,
    artist: any,
    createdRole: any;
  let remoteUid: string | null = null,
    hookCreated = false,
    verifiedWebhooks = 0;
  let sourceRequests = 0;
  const config = new ConfigService(process.env);
  try {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [FilesController, VideosController, VideoDeliveryController],
      providers: [
        PrismaService,
        { provide: MinioService, useValue: storage },
        VercelBlobService,
        HlsTranscoderService,
        MediaService,
        VideosService,
        VideoDeliveryService,
        CloudflareStreamService,
        JwtStrategy,
        PermissionsGuard,
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    app = module.createNestApplication({ rawBody: true, logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    db = app.get(PrismaService);
    assert.equal(
      await db.videoDelivery.count({
        where: { status: { in: ['QUEUED', 'PROCESSING', 'RETRY'] } },
      }),
      0,
      'Do not process pre-existing jobs',
    );
    const base = new URL(await app.getUrl());
    relay = createServer((req, res) => {
      const path = new URL(req.url || '/', 'http://localhost');
      const match = /^\/video-delivery\/source\/([a-f0-9-]+)$/.exec(
        path.pathname,
      );
      const source =
        ['GET', 'HEAD'].includes(req.method || '') &&
        match &&
        sources.has(match[1]);
      const webhook =
        req.method === 'POST' && path.pathname === '/video-delivery/webhook';
      if (!source && !webhook) {
        res.writeHead(404);
        res.end();
        return;
      }
      const upstream = httpRequest(
        {
          hostname: '127.0.0.1',
          port: base.port,
          path: req.url,
          method: req.method,
          headers: {
            ...(webhook
              ? {
                  'Content-Type': 'application/json',
                  'Webhook-Signature': req.headers['webhook-signature'] || '',
                }
              : {}),
          },
        },
        (response) => {
          if (source && response.statusCode === 200) sourceRequests++;
          if (webhook && response.statusCode === 201) verifiedWebhooks++;
          res.writeHead(response.statusCode || 502, response.headers);
          response.pipe(res);
        },
      );
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      upstream.setTimeout(30_000, () => upstream.destroy());
      let bytes = 0;
      req.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 65_536) {
          upstream.destroy();
          req.destroy();
        }
      });
      req.pipe(upstream);
    });
    await new Promise<void>((done) => relay.listen(0, '127.0.0.1', done));
    let publicOrigin = '';
    let tunnelLog = '';
    let registered = false;
    const binary =
      process.env.CLOUDFLARED_PATH ||
      join(tmpdir(), 'pyramidplay-cloudflared.exe');
    tunnel = spawn(
      binary,
      [
        'tunnel',
        '--no-autoupdate',
        '--protocol',
        'http2',
        '--edge-ip-version',
        '4',
        '--url',
        `http://127.0.0.1:${relay.address().port}`,
      ],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let tunnelError = false;
    tunnel.on('error', () => {
      tunnelError = true;
    });
    tunnel.stderr.on('data', (chunk) => {
      tunnelLog = (tunnelLog + chunk.toString()).slice(-16000);
      const match = tunnelLog.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) publicOrigin = match[0];
      if (tunnelLog.includes('Registered tunnel connection')) registered = true;
    });
    for (
      let i = 0;
      i < 60 &&
      (!publicOrigin || !registered) &&
      !tunnelError &&
      tunnel.exitCode === null;
      i++
    )
      await wait(1000);
    assert(publicOrigin && registered, 'Temporary tunnel unavailable');
    console.log(
      'Temporary tunnel connected; Stream itself will verify original reachability.',
    );
    const privateRoute = await fetch(
      `http://127.0.0.1:${relay.address().port}/private-route-check`,
    );
    assert.equal(privateRoute.status, 404);
    await privateRoute.arrayBuffer();
    hookCreated = true;
    const hook = await api('/webhook', 'PUT', {
      notificationUrl: publicOrigin + '/video-delivery/webhook',
    });
    assert(hook.secret, 'Webhook secret missing');
    config.set('CLOUDFLARE_STREAM_WEBHOOK_SECRET', hook.secret);
    config.set('VIDEO_DELIVERY_ORIGIN_URL', publicOrigin);
    config.set('VIDEO_DELIVERY_PROVIDER', 'cloudflare');
    config.set('CLOUDFLARE_STREAM_ALLOWED_ORIGINS', 'localhost');
    const denied = await fetch(base.origin + '/video-delivery/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(denied.status, 401);
    await denied.arrayBuffer();
    let role = await db.role.findUnique({ where: { name: 'ADMIN' } });
    if (!role) {
      role = await db.role.create({ data: { name: 'ADMIN' } });
      createdRole = role;
    }
    user = await db.user.create({
      data: {
        email: marker + '@local-validation.invalid',
        name: marker,
        password: randomBytes(32).toString('hex'),
        roleId: role.id,
        systemRoles: ['ADMIN'],
      },
    });
    artist = await db.artist.create({
      data: { name: marker, userId: user.id },
    });
    const auth = jwt.sign(
      { sub: user.id, role: 'ADMIN' },
      process.env.JWT_SECRET || 'secretKey',
      { expiresIn: '15m' },
    );
    const local = async (path: string, data?: any, authenticated = true) => {
      const response = await fetch(base.origin + path, {
        method: data ? 'POST' : 'GET',
        headers: {
          ...(authenticated ? { Authorization: `Bearer ${auth}` } : {}),
          ...(data && !(data instanceof FormData)
            ? { 'Content-Type': 'application/json' }
            : {}),
        },
        body:
          data instanceof FormData
            ? data
            : data
              ? JSON.stringify(data)
              : undefined,
      });
      return { status: response.status, body: await response.json() };
    };
    const mp4 = join(temp, 'fixture.mp4');
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=320x180:r=24',
        '-t',
        '3',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        mp4,
      ],
      { stdio: 'pipe', windowsHide: true },
    );
    const original = readFileSync(mp4);
    const form = new FormData();
    form.append(
      'file',
      new Blob([original], { type: 'video/mp4' }),
      marker + '.mp4',
    );
    const upload = await local('/files/upload-video', form);
    assert.equal(upload.status, 201);
    const assetId = upload.body.mediaAssetId;
    assert(assetId);
    sources.add(assetId);
    const sourceDenied = await fetch(
      base.origin + '/video-delivery/source/' + assetId,
    );
    assert.equal(sourceDenied.status, 401);
    await sourceDenied.arrayBuffer();
    const created = await local('/videos', {
      title: marker,
      videoUrl: upload.body.url,
      mediaAssetId: assetId,
      channelId: artist.id,
      duration: 3,
      isPublished: true,
      isMonetized: false,
    });
    assert.equal(created.status, 201);
    const videoId = created.body.id;
    assert.equal(
      (await db.video.findUnique({ where: { id: videoId } })).isPublished,
      false,
    );
    console.log(
      'PASS real ADMIN upload: original retained, publication waits for Stream, unsigned source/webhook refused.',
    );
    const delivery = app.get(VideoDeliveryService);
    const start = Date.now();
    let ready = false;
    while (Date.now() - start < 300_000) {
      await delivery.processNext();
      const job = await db.videoDelivery.findUnique({
        where: { mediaAssetId: assetId },
      });
      remoteUid = job?.remoteUid || remoteUid;
      if (job?.status === 'ERROR')
        throw new Error('Cloudflare processing failed: ' + job.failureCode);
      if (job?.status === 'READY') {
        ready = true;
        break;
      }
      await wait(10_000);
    }
    assert(ready, 'Stream preparation timeout');
    assert(sourceRequests > 0, 'No signed original request received');
    assert.equal(
      (await db.video.findUnique({ where: { id: videoId } })).isPublished,
      true,
    );
    const playback = await local(
      '/video-delivery/playback/' + videoId,
      undefined,
      false,
    );
    assert.equal(playback.status, 200);
    const mediaHeaders = {
      Origin: 'http://localhost',
      Referer: 'http://localhost/',
    };
    let manifestUrl = playback.body.url;
    let segmentRead = false;
    for (let depth = 0; depth < 4 && !segmentRead; depth++) {
      const response = await fetch(manifestUrl, {
        headers: mediaHeaders,
        signal: AbortSignal.timeout(20_000),
      });
      assert(response.ok, 'Signed HLS manifest unavailable');
      const text = await response.text();
      assert(text.startsWith('#EXTM3U'));
      const next = text
        .split(/\r?\n/)
        .find((line) => line.trim() && !line.startsWith('#'));
      assert(next, 'Empty HLS playlist');
      const nextUrl = new URL(next!, manifestUrl).toString();
      if (text.includes('#EXTINF:')) {
        const segment = await fetch(nextUrl, {
          headers: mediaHeaders,
          signal: AbortSignal.timeout(20_000),
        });
        assert(
          segment.ok && (await segment.arrayBuffer()).byteLength > 0,
          'HLS segment unavailable',
        );
        segmentRead = true;
      } else manifestUrl = nextUrl;
    }
    assert(segmentRead, 'No playable HLS segment fetched');
    await db.video.update({
      where: { id: videoId },
      data: { isMonetized: true, price: 100 },
    });
    assert.equal(
      (await local('/video-delivery/playback/' + videoId, undefined, false))
        .status,
      403,
    );
    assert.equal(
      (await local('/video-delivery/playback/' + videoId)).status,
      200,
    );
    for (let i = 0; i < 18 && !verifiedWebhooks; i++) await wait(5000);
    assert(verifiedWebhooks > 0, 'No verified real webhook received');
    const asset = await db.mediaAsset.findUnique({ where: { id: assetId } });
    const stream = await minio.getObject(
      asset.originalBucket,
      asset.originalObject,
    );
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert(
      Buffer.concat(chunks).equals(original),
      'Original changed after delivery',
    );
    console.log(
      'PASS real Cloudflare: signed source downloaded, encoded, published, signed HLS manifest/segment fetched, paid access enforced, authentic webhook received, original byte-identical in MinIO.',
    );
  } finally {
    // Cleanup only resources created by this run; never overwrite user configuration.
    let cleanupFailures = 0;
    const cleanup = async (label: string, action: () => Promise<void>) => {
      try {
        await action();
      } catch {
        cleanupFailures++;
        console.error('Cleanup requires attention: ' + label);
      }
    };
    await cleanup('synthetic Cloudflare video', async () => {
      if (!remoteUid && db && user) {
        const job = await db.videoDelivery.findFirst({
          where: { mediaAsset: { userId: user.id } },
        });
        remoteUid = job?.remoteUid || null;
      }
      const remoteIds = new Set<string>(remoteUid ? [remoteUid] : []);
      // A timed-out copy may have been accepted before its UID reached PostgreSQL.
      for (const sourceId of sources) {
        const found = await api('?search=' + sourceId);
        for (const remote of found || [])
          if (remote.meta?.mediaAssetId === sourceId) remoteIds.add(remote.uid);
      }
      for (const remoteId of remoteIds)
        if (db && user) {
          const remote = await api('/' + remoteId, 'GET', undefined, true);
          const ownAsset =
            remote?.meta?.mediaAssetId &&
            (await db.mediaAsset.findFirst({
              where: { id: remote.meta.mediaAssetId, userId: user.id },
            }));
          if (ownAsset) await api('/' + remoteId, 'DELETE');
        }
    });
    await cleanup('temporary webhook', async () => {
      if (hookCreated) await api('/webhook', 'DELETE');
    });
    if (tunnel) tunnel.kill();
    relay?.closeAllConnections();
    if (relay) await new Promise<void>((done) => relay.close(() => done()));
    await cleanup('local database fixtures', async () => {
      if (db && user) {
        const videos = await db.video.findMany({
          where: { userId: user.id },
          select: { id: true },
        });
        const ids = videos.map((v: any) => v.id);
        await db.videoTaxonomyEvent.deleteMany({
          where: { videoId: { in: ids } },
        });
        await db.videoTagOnVideo.deleteMany({
          where: { videoId: { in: ids } },
        });
        await db.video.deleteMany({ where: { userId: user.id } });
        await db.videoDelivery.deleteMany({
          where: { mediaAsset: { userId: user.id } },
        });
        await db.mediaAsset.deleteMany({ where: { userId: user.id } });
        if (artist) await db.artist.delete({ where: { id: artist.id } });
        await db.user.delete({ where: { id: user.id } });
        if (createdRole)
          await db.role.delete({ where: { id: createdRole.id } });
      }
    });
    for (const bucket of [
      process.env.MINIO_BUCKET_VIDEOS!,
      process.env.MINIO_BUCKET_IMAGES!,
    ]) {
      await cleanup('fixture bucket ' + bucket, async () => {
        assert(bucket.startsWith(marker));
        if (await minio.bucketExists(bucket)) {
          const objects: string[] = [];
          for await (const object of minio.listObjectsV2(bucket, '', true))
            if (object.name) objects.push(object.name);
          if (objects.length) await minio.removeObjects(bucket, objects);
          await minio.removeBucket(bucket);
        }
      });
    }
    if (app) await app.close();
    rmSync(temp, { recursive: true, force: true });
    if (cleanupFailures)
      console.error(
        JSON.stringify({ marker, sourceIds: [...sources], remoteUid }),
      );
    assert.equal(cleanupFailures, 0, 'Some test resources require cleanup');
    console.log(
      'Temporary test resources cleaned; local configuration unchanged.',
    );
  }
}
main().catch((error) => {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : 'Local Cloudflare test failed: ' +
          String(error.message || 'unknown').replace(
            /https?:\/\/\S+/g,
            '[URL masked]',
          ),
  );
  process.exitCode = 1;
});
