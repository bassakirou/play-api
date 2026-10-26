/** Real local integration: run from apps/play-api using
 * node -r ts-node/register/transpile-only scripts/verify-hybrid-local.ts
 * Uses real controllers/services, PostgreSQL, MinIO and ffmpeg; no mocked storage.
 * Isolated module avoids unrelated startup seeders/cron jobs. All created IDs and
 * dedicated temporary buckets are removed in finally. Never loads production .env.
 */
import 'reflect-metadata';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { randomBytes, randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { parse } from 'dotenv';
import { strict as assert } from 'assert';

async function main() {
  const apiRoot = resolve(__dirname, '..');
  process.chdir(apiRoot);
  Object.assign(process.env, parse(readFileSync(join(apiRoot, '.env.local'))));
  const local = (host: string) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
  assert(local(new URL(process.env.DATABASE_URL!).hostname), 'Database must be loopback');
  assert(local(process.env.MINIO_ENDPOINT!), 'MinIO must be loopback');
  assert(local(new URL(process.env.MINIO_PUBLIC_URL!).hostname), 'MinIO public URL must be loopback');
  process.env.NODE_ENV = 'test';
  process.env.VIDEO_DELIVERY_PROVIDER = 'minio';
  process.env.BLOB_READ_WRITE_TOKEN = '';
  const marker = `hybrid-local-${randomUUID()}`;
  process.env.MINIO_BUCKET_VIDEOS = `${marker}-videos`;
  process.env.MINIO_BUCKET_IMAGES = `${marker}-images`;
  const { Test } = require('@nestjs/testing');
  const { ValidationPipe } = require('@nestjs/common');
  const { ConfigService } = require('@nestjs/config');
  const { PassportModule } = require('@nestjs/passport');
  const { PrismaService } = require('../src/prisma/prisma.service');
  const { MinioService } = require('../src/storage/minio.service');
  const { VercelBlobService } = require('../src/storage/vercel-blob.service');
  const { HlsTranscoderService } = require('../src/storage/hls-transcoder.service');
  const { MediaService } = require('../src/media/media.service');
  const { MediaController } = require('../src/media/media.controller');
  const { FilesController } = require('../src/files/files.controller');
  const { VideosService } = require('../src/videos/videos.service');
  const { VideosController } = require('../src/videos/videos.controller');
  const { VideoDeliveryService } = require('../src/video-delivery/video-delivery.service');
  const { CloudflareStreamService } = require('../src/video-delivery/cloudflare-stream.service');
  const { JwtStrategy } = require('../src/auth/jwt.strategy');
  const { PermissionsGuard } = require('../src/auth/permissions.guard');
  const { Client } = require('minio');
  const jwt = require('jsonwebtoken');
  const storage = new MinioService();
  // Existing production startup hook rewrites every bucket policy. Suppress only
  // this unrelated hook; upload/streaming methods run unchanged on fixture buckets.
  storage.onModuleInit = async () => {};
  // getObjectStream checks historical aliases before reading. Do not let those
  // checks rewrite policies on any shared local bucket.
  (storage as any).policyApplied.add('videos');
  (storage as any).policyApplied.add('play-videos');
  const minio = new Client({ endPoint: process.env.MINIO_ENDPOINT, port: Number(process.env.MINIO_PORT || 9000), useSSL: process.env.MINIO_USE_SSL === 'true', accessKey: process.env.MINIO_ACCESS_KEY, secretKey: process.env.MINIO_SECRET_KEY });
  const temp = mkdtempSync(join(tmpdir(), 'pyramidplay-hybrid-'));
  const users: string[] = [], roles: string[] = [], artists: string[] = [];
  const results: string[] = [];
  let app: any, prisma: any;
  try {
    const mp4 = join(temp, 'fixture.mp4');
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: 'pipe' });
    const original = readFileSync(mp4);
    const module = await Test.createTestingModule({ imports: [PassportModule], controllers: [FilesController, MediaController, VideosController], providers: [PrismaService, { provide: MinioService, useValue: storage }, VercelBlobService, HlsTranscoderService, MediaService, VideosService, VideoDeliveryService, CloudflareStreamService, JwtStrategy, PermissionsGuard, { provide: ConfigService, useValue: new ConfigService(process.env) }] }).compile();
    app = module.createNestApplication({ rawBody: true, logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    const base = await app.getUrl();
    const request = async (path: string, token?: string, data?: any, method = data ? 'POST' : 'GET') => {
      const headers: any = token ? { Authorization: `Bearer ${token}` } : {};
      if (data && !(data instanceof FormData)) headers['Content-Type'] = 'application/json';
      const response = await fetch(base + path, { method, headers, body: data instanceof FormData ? data : data ? JSON.stringify(data) : undefined });
      const text = await response.text();
      const body = text ? JSON.parse(text) : null;
      return { status: response.status, body };
    };
    const fixtures: any[] = [];
    for (const roleName of ['ADMIN', 'CREATOR', 'CREATOR']) {
      let role = await prisma.role.findUnique({ where: { name: roleName } });
      if (!role) { role = await prisma.role.create({ data: { name: roleName } }); roles.push(role.id); }
      const user = await prisma.user.create({ data: { email: `${randomUUID()}@local-validation.invalid`, name: marker, password: randomBytes(32).toString('hex'), roleId: role.id, systemRoles: [roleName] } });
      users.push(user.id);
      const artist = await prisma.artist.create({ data: { name: marker, userId: user.id } });
      artists.push(artist.id);
      fixtures.push({ user, artist, token: jwt.sign({ sub: user.id, email: user.email, role: roleName }, process.env.JWT_SECRET || 'secretKey', { expiresIn: '10m' }) });
    }
    for (const [i, path] of ['/files/upload-video', '/media/upload'].entries()) {
      const fixture = fixtures[i];
      const form = new FormData();
      form.append('file', new Blob([original], { type: 'video/mp4' }), `${marker}.mp4`);
      if (i) form.append('type', 'video');
      const uploaded = await request(path, fixture.token, form);
      assert.equal(uploaded.status, 201, `${path} status ${uploaded.status}`);
      const assetId = uploaded.body.mediaAssetId || uploaded.body.id;
      const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
      assert.equal(asset.userId, fixture.user.id);
      assert.equal(asset.originalBucket, process.env.MINIO_BUCKET_VIDEOS);
      const stream = await minio.getObject(asset.originalBucket, asset.originalObject);
      const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(chunk);
      assert(Buffer.concat(chunks).equals(original), 'Stored original bytes changed');
      results.push(`PASS ${path}: real MP4 original preserved in MinIO, asset ownership recorded`);
      const publication = { title: marker, videoUrl: asset.fileUrl, mediaAssetId: asset.id, duration: 2, channelId: fixture.artist.id, isPublished: true, isMonetized: false };
      const created = await request('/videos', fixture.token, publication);
      assert.equal(created.status, 201, `Publication status ${created.status}`);
      const video = await prisma.video.findUniqueOrThrow({ where: { id: created.body.id } });
      assert.equal(video.mediaAssetId, asset.id); assert.equal(video.isPublished, true);
      assert.equal(video.userId, fixture.user.id);
      const publicVideo = await request(`/videos/${video.id}`);
      assert.equal(publicVideo.status, 200); assert.equal(publicVideo.body.id, video.id);
      const playback = new URL(publicVideo.body.videoUrl); assert(local(playback.hostname), 'Public playback left loopback');
      const full = await fetch(playback); assert.equal(full.status, 200);
      assert(Buffer.from(await full.arrayBuffer()).equals(original));
      const range = await fetch(playback, { headers: { Range: 'bytes=0-31' } });
      assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 32);
      const proxy = await fetch(`${base}/files/resolved-video?url=${encodeURIComponent(asset.fileUrl)}`, { headers: { Range: 'bytes=0-31' } });
      const proxyLength = (await proxy.arrayBuffer()).byteLength;
      results.push(`PASS ${i ? 'CREATOR' : 'ADMIN'}: published source association, public GET, full HTTP bytes and MinIO Range 206`);
      results.push(`${proxy.status === 206 && proxyLength === 32 ? 'PASS' : 'FAIL'} resolved-video Range: HTTP ${proxy.status}, ${proxyLength} bytes (expected 206, 32)`);
      // Exercise the normal /videos/ fast path too: getObjectStream maps this
      // logical bucket to MINIO_BUCKET_VIDEOS, still our dedicated fixture bucket.
      const logicalUrl = `${process.env.MINIO_PUBLIC_URL}/videos/${asset.originalObject}`;
      const directProxy = await fetch(`${base}/files/resolved-video?url=${encodeURIComponent(logicalUrl)}`, { headers: { Range: 'bytes=0-31' } });
      const directLength = (await directProxy.arrayBuffer()).byteLength;
      results.push(`${directProxy.status === 206 && directLength === 32 ? 'PASS' : 'FAIL'} resolved-video logical videos fast path Range: HTTP ${directProxy.status}, ${directLength} bytes (expected 206, 32)`);
      const logicalProxy = `${base}/files/resolved-video?url=${encodeURIComponent(logicalUrl)}`;
      for (const header of ['bytes=32-', 'bytes=-32', 'bytes=0-999999']) {
        const response = await fetch(logicalProxy, { headers: { Range: header } });
        assert.equal(response.status, 206, header);
        const expected = header === 'bytes=32-' ? original.subarray(32) : header === 'bytes=-32' ? original.subarray(-32) : original;
        assert(Buffer.from(await response.arrayBuffer()).equals(expected), `${header} bytes differ`);
      }
      const invalid = await fetch(logicalProxy, { headers: { Range: `bytes=${original.length}-` } });
      assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('content-range'), `bytes */${original.length}`);
      await invalid.arrayBuffer();
      results.push('PASS proxy open-ended, suffix, oversized-end and unsatisfiable ranges');
      const denied = await request('/videos', fixtures[2].token, publication);
      assert.equal(denied.status, 403, 'Other creator attached private source');
      const hidden = await request(`/media/${asset.id}`, fixtures[2].token);
      assert.equal(hidden.body, null, 'Other creator could inspect source');
      await request(`/media/${asset.id}`, fixtures[2].token, undefined, 'DELETE');
      // Existing delete API acknowledges absent/unowned IDs as a no-op.
      assert.equal(await prisma.mediaAsset.count({ where: { id: asset.id } }), 1, 'Other creator deleted source');
      const referenced = await request(`/media/${asset.id}`, fixture.token, undefined, 'DELETE');
      assert(referenced.status >= 400, 'Referenced source was deletable');
      results.push('PASS other creator source association/read/delete denied; referenced original deletion denied');
    }
    assert.equal(await prisma.videoDelivery.count({ where: { mediaAsset: { userId: { in: users } } } }), 0);
    results.push('PASS MinIO mode creates no Cloudflare delivery jobs');
  } finally {
    // Scope database cleanup strictly to new users, even after partial HTTP failures.
    if (prisma && users.length) {
      const videos = await prisma.video.findMany({ where: { userId: { in: users } }, select: { id: true } });
      const ids = videos.map((v: any) => v.id);
      await prisma.videoTaxonomyEvent.deleteMany({ where: { videoId: { in: ids } } });
      await prisma.videoTagOnVideo.deleteMany({ where: { videoId: { in: ids } } });
      await prisma.video.deleteMany({ where: { id: { in: ids } } });
      await prisma.mediaAsset.deleteMany({ where: { userId: { in: users } } });
      await prisma.artist.deleteMany({ where: { id: { in: artists } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.role.deleteMany({ where: { id: { in: roles } } });
      assert.equal(await prisma.user.count({ where: { id: { in: users } } }), 0);
    }
    for (const bucket of [process.env.MINIO_BUCKET_VIDEOS!, process.env.MINIO_BUCKET_IMAGES!]) {
      assert(bucket.startsWith(marker), 'Cleanup bucket scope mismatch');
      if (await minio.bucketExists(bucket)) {
        const objects: string[] = []; for await (const object of minio.listObjectsV2(bucket, '', true)) if (object.name) objects.push(object.name);
        if (objects.length) await minio.removeObjects(bucket, objects);
        await minio.removeBucket(bucket);
      }
    }
    if (app) await app.close();
    rmSync(temp, { recursive: true, force: true });
    for (const result of results) console.log(result);
    console.log('CLEANUP complete: fixture records, dedicated MinIO buckets and temporary MP4 removed');
  }
  if (results.some(result => result.startsWith('FAIL'))) process.exitCode = 1;
}
main().catch(error => { console.error(`LOCAL VERIFICATION FAILED: ${error.name}: ${error.message}`); process.exitCode = 1; });
