const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
require('dotenv').config({ path: resolve(__dirname, '../.env.local'), quiet: true });
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const db = new PrismaClient();
const prefix = `analytics-check-${randomUUID()}`;
const users = [], artists = [];
async function main() {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname));
  const role = await db.role.findFirst({ where: { name: { notIn: ['ADMIN', 'SUPER_ADMIN'] } } });
  assert.ok(role);
  for (let i = 0; i < 2; i++) {
    const user = await db.user.create({ data: { email: `${prefix}-${i}@example.invalid`, name: prefix, password: randomUUID(), roleId: role.id, systemRoles: ['CREATOR'] } }); users.push(user.id);
    const artist = await db.artist.create({ data: { userId: user.id, name: prefix } }); artists.push(artist.id);
    await db.song.create({ data: { title: `${prefix}-${i}`, duration: 1, audioUrl: 'https://example.invalid/test.mp3', plays: i ? 900 : 7, artists: { connect: { id: artist.id } } } });
    await db.video.create({ data: { title: `${prefix}-${i}`, duration: 1, videoUrl: 'https://example.invalid/test.mp4', userId: user.id, views: i ? 800 : 3 } });
    await db.album.create({ data: { title: prefix, year: 2026, artistId: artist.id } });
    await db.audiobook.create({ data: { title: prefix, author: prefix, authorId: user.id } });
    await db.academicCourse.create({ data: { title: prefix, instructorId: user.id } });
    await db.transaction.create({ data: { productId: `${prefix}-${i}`, type: 'CONTENT_PURCHASE', amount: 100, creatorShare: i ? 700 : 70, beneficiaryUserId: user.id, status: 'SUCCESS' } });
  }
  const anonymous = await fetch('http://localhost:3022/stats/creator'); assert.equal(anonymous.status, 401);
  for (let i = 0; i < 2; i++) {
    const token = jwt.sign({ sub: users[i] }, process.env.JWT_SECRET || 'secretKey', { expiresIn: '5m' });
    const res = await fetch(`http://localhost:3022/stats/creator?userId=${users[1-i]}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'private, no-store');
    const data = await res.json();
    assert.equal(data.plays, i ? 900 : 7); assert.equal(data.views, i ? 800 : 3); assert.equal(data.creatorRevenue, i ? 700 : 70);
    for (const collection of ['songs', 'videos', 'albums', 'books', 'courses']) assert.equal(data[collection].length, 1);
    assert.equal(data.uniqueListeners, null);
  }
  console.log('PASS: authenticated account isolation, ignored foreign userId query, own revenue and five content types, anonymous 401, private/no-store.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await db.transaction.deleteMany({ where: { productId: { startsWith: prefix } } });
  for (const model of ['song', 'video', 'album', 'audiobook', 'academicCourse']) await db[model].deleteMany({ where: { title: { startsWith: prefix } } });
  await db.artist.deleteMany({ where: { id: { in: artists } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});
