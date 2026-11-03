const fs = require('node:fs');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
require('dotenv').config({ path: resolve(__dirname, '../.env.local'), override: true, quiet: true });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { PrismaClient } = require('@prisma/client');
const { Client } = require('minio');
const { VideoDeliveryService } = require('../src/video-delivery/video-delivery.service');
const { ContentAccessService } = require('../src/content-access/content-access.service');
const { MinioService } = require('../src/storage/minio.service');
const db = new PrismaClient();
const prefix = `routing-test-${randomUUID()}`;
const users = []; let video, assetId, previousPolicy;
const minio = new MinioService();
const bucket = minio.getBucketName('videos');
const object = `${prefix}.mp4`;
const storage = new Client({ endPoint: process.env.MINIO_ENDPOINT || '127.0.0.1', port: Number(process.env.MINIO_PORT || 9000), useSSL: process.env.MINIO_USE_SSL === 'true', accessKey: process.env.MINIO_ACCESS_KEY, secretKey: process.env.MINIO_SECRET_KEY });
async function main() {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname));
  assert.ok(['localhost', '127.0.0.1'].includes(process.env.MINIO_ENDPOINT || '127.0.0.1'));
  previousPolicy = await db.videoRoutingPolicy.findUnique({ where: { id: 'default' } });
  const role = await db.role.findFirst({ where: { name: { notIn: ['ADMIN', 'SUPER_ADMIN'] } } });
  for (let i = 0; i < 2; i++) users.push(await db.user.create({ data: { name: prefix, email: `${prefix}-${i}@example.invalid`, password: randomUUID(), roleId: role.id } }));
  await storage.putObject(bucket, object, Buffer.from('local fixture, never sent to Cloudflare'));
  video = await db.video.create({ data: { title: prefix, videoUrl: `${process.env.MINIO_PUBLIC_URL || 'http://localhost:9000'}/${bucket}/${object}`, duration: 1, userId: users[0].id, isPublished: true, isMonetized: true, price: 100 } });
  const access = new ContentAccessService(db);
  let calls = 0;
  const cloudflare = { isEnabled: () => true, playback: async () => { calls++; throw new Error('simulated outage'); } };
  const service = new VideoDeliveryService(db, minio, cloudflare, access);
  await service.setRouting('CLOUDFLARE_FIRST');
  await Promise.all([service.migrate(video.id), service.migrate(video.id)]);
  const migrated = await db.video.findUnique({ where: { id: video.id } }); assetId = migrated.mediaAssetId;
  assert.ok(assetId); assert.equal(migrated.isPublished, true); assert.equal(migrated.id, video.id);
  assert.equal(await db.videoDelivery.count({ where: { mediaAssetId: assetId } }), 1);
  await assert.rejects(service.playback(video.id, { id: users[1].id }, true));
  await db.userPurchasedContent.create({ data: { userId: users[1].id, contentId: video.id, contentType: 'VIDEO', pricePaid: 100 } });
  await db.videoDelivery.update({ where: { mediaAssetId: assetId }, data: { status: 'READY', remoteUid: prefix } });
  const result = await service.playback(video.id, { id: users[1].id });
  assert.equal(result.provider, 'MINIO'); assert.ok(result.url.startsWith('/content-access/stream?ticket=')); assert.equal(calls, 1);
  // Managed synthetic references must also resolve the retained original.
  await db.video.update({ where: { id: video.id }, data: { videoUrl: `pyramidplay:video:${video.id}` } });
  assert.ok((await access.source('VIDEO', video.id, { id: users[1].id })).endsWith(object));
  await service.setRouting('LOCAL_ONLY'); await service.playback(video.id, { id: users[1].id }); assert.equal(calls, 1);
  await db.userPurchasedContent.deleteMany({ where: { userId: users[1].id } });
  await assert.rejects(access.source('VIDEO', video.id, { id: users[1].id }));
  console.log('PASS: real PostgreSQL/MinIO, concurrent idempotent migration, unchanged publication/id, paid access, outage fallback, protected ticket, retained source, manual mode, revoked access. No Cloudflare upload.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(async () => {
  if (previousPolicy !== undefined) {
    if (previousPolicy) await db.videoRoutingPolicy.upsert({ where: { id: 'default' }, create: previousPolicy, update: { mode: previousPolicy.mode } });
    else await db.videoRoutingPolicy.deleteMany({ where: { id: 'default' } });
  }
  if (video) { const current = await db.video.findUnique({ where: { id: video.id } }); assetId ||= current?.mediaAssetId; await db.video.deleteMany({ where: { id: video.id } }); }
  if (assetId) { await db.videoDelivery.deleteMany({ where: { mediaAssetId: assetId } }); await db.mediaAsset.deleteMany({ where: { id: assetId } }); }
  await db.userPurchasedContent.deleteMany({ where: { userId: { in: users.map(u => u.id) } } });
  await db.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } });
  await storage.removeObject(bucket, object).catch(() => {});
  await db.$disconnect();
});
