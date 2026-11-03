/* Local development smoke test. No Tara calls: records only fixture access rights.
 * Run from apps/play-api: node scripts/verify-local-content-payments.cjs
 * All fixture rows and the generated WAV are removed in finally.
 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { resolve, join } = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
require('dotenv').config({ path: resolve(__dirname, '../.env.local'), quiet: true });
const { PrismaClient } = require('@prisma/client');
const { Client } = require('minio');
const jwt = require('jsonwebtoken');
const db = new PrismaClient();
const api = process.env.LOCAL_PAYMENT_TEST_API || 'http://localhost:3022';
const prefix = `payment-smoke-${randomUUID()}`;
const ids = { users: [], songs: [], albums: [], books: [], courses: [], artists: [], videos: [] };
const storage = new Client({ endPoint: process.env.MINIO_ENDPOINT || '127.0.0.1', port: Number(process.env.MINIO_PORT || 9000), useSSL: process.env.MINIO_USE_SSL === 'true', accessKey: process.env.MINIO_ACCESS_KEY, secretKey: process.env.MINIO_SECRET_KEY });
const bucket = process.env.MINIO_BUCKET_AUDIO || 'audio';
const object = `${prefix}.wav`;
const source = `${process.env.MINIO_PUBLIC_URL || 'http://localhost:9000'}/${bucket}/${object}`;
const videoBucket = process.env.MINIO_BUCKET_VIDEOS || 'videos';
const videoObject = `${prefix}.mp4`;
const videoTemp = join(os.tmpdir(), `${prefix}.mp4`);
const cases = [];
function token(user) { return jwt.sign({ sub: user.id, role: 'MEMBER' }, process.env.JWT_SECRET || 'secretKey', { expiresIn: '10m' }); }
async function request(path, user, options = {}) {
  return fetch(new URL(path, api), { ...options, headers: { ...(user ? { Authorization: `Bearer ${token(user)}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
}
async function expectStatus(path, user, expected, options) {
  const response = await request(path, user, options);
  assert.equal(response.status, expected, `${path}: expected ${expected}, got ${response.status}: ${response.status === expected ? '' : await response.text()}`);
  return response;
}
async function purchase(user, type, contentId) {
  await db.userPurchasedContent.create({ data: { userId: user.id, contentId, contentType: type, pricePaid: 100, title: prefix } });
}
async function main() {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname), 'Only a local database is permitted');
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(api).hostname), 'Only a local API is permitted');
  const health = await request('/health');
  assert.equal((await health.json()).database, 'connected');
  const role = await db.role.findFirst({ where: { name: { notIn: ['ADMIN', 'SUPER_ADMIN'] } } });
  assert.ok(role, 'A non-administrative development role must exist');
  const users = [];
  for (let i = 0; i < 3; i++) {
    const user = await db.user.create({ data: { email: `${prefix}-${i}@example.invalid`, name: `${prefix}-${i}`, password: randomUUID(), roleId: role.id, systemRoles: i === 0 ? ['ACADEMIC'] : [] } });
    users.push(user); ids.users.push(user.id);
  }
  const [owner, buyer, other] = users;
  const artist = await db.artist.create({ data: { name: prefix, userId: owner.id } }); ids.artists.push(artist.id);
  const wav = Buffer.alloc(44 + 16000);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
  await storage.putObject(bucket, object, wav, wav.length, { 'Content-Type': 'audio/wav' });
  const song = await db.song.create({ data: { title: prefix, duration: 1, audioUrl: source, isSingle: true, isMonetized: true, price: 100, artists: { connect: { id: artist.id } } } }); ids.songs.push(song.id);
  const publicSong = await (await expectStatus(`/songs/${song.id}`, undefined, 200)).json();
  assert.equal(publicSong.audioUrl, `pyramidplay:audio:SONG:${song.id}`);
  await expectStatus(`/content-access/playback/SONG/${song.id}`, buyer, 403);
  await expectStatus(`/files/resolved-audio?url=${encodeURIComponent(source)}`, undefined, 403);
  const direct = await fetch(source); assert.equal(direct.status, 403, 'Bucket must deny direct media reads');
  await purchase(buyer, 'SONG', song.id);
  const playback = await (await expectStatus(`/content-access/playback/SONG/${song.id}`, buyer, 200)).json();
  const range = await expectStatus(playback.url, undefined, 206, { headers: { Range: 'bytes=0-43' } });
  assert.equal(Buffer.from(await range.arrayBuffer()).length, 44);
  await expectStatus(`/content-access/playback/SONG/${song.id}`, other, 403);
  await expectStatus(playback.url + 'tampered', undefined, 401);
  cases.push('Paid song: catalog source hidden, storage/proxy denied, buyer Range206, other account denied, forged ticket denied');
  const album = await db.album.create({ data: { title: prefix, year: 2026, artistId: artist.id, isMonetized: true, price: 100 } }); ids.albums.push(album.id);
  const track = await db.song.create({ data: { title: prefix, duration: 1, audioUrl: source, albumId: album.id, artists: { connect: { id: artist.id } } } }); ids.songs.push(track.id);
  await expectStatus(`/content-access/playback/SONG/${track.id}`, buyer, 403);
  await purchase(buyer, 'ALBUM', album.id);
  await expectStatus(`/content-access/playback/SONG/${track.id}`, buyer, 200);
  cases.push('Album purchase grants its free-looking track, unpaid album track denied');
  const generated = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=5', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoTemp], { encoding: 'utf8' });
  assert.equal(generated.status, 0, 'FFmpeg must be installed to generate the local test video');
  const videoBytes = fs.readFileSync(videoTemp);
  await storage.putObject(videoBucket, videoObject, videoBytes, videoBytes.length, { 'Content-Type': 'video/mp4' });
  const videoSource = `${process.env.MINIO_PUBLIC_URL || 'http://localhost:9000'}/${videoBucket}/${videoObject}`;
  const video = await db.video.create({ data: { title: prefix, videoUrl: videoSource, duration: 1, userId: owner.id, isPublished: true, isMonetized: true, price: 100, artists: { connect: { id: artist.id } } } }); ids.videos.push(video.id);
  await expectStatus(`/video-delivery/playback/${video.id}`, buyer, 403);
  await purchase(buyer, 'VIDEO', video.id);
  const videoPlayback = await (await expectStatus(`/video-delivery/playback/${video.id}`, buyer, 200)).json();
  const videoRange = await expectStatus(videoPlayback.url, undefined, 206, { headers: { Range: 'bytes=0-31' } });
  assert.equal(Buffer.from(await videoRange.arrayBuffer()).length, 32);
  assert.match(videoRange.headers.get('content-type'), /video\/mp4/);
  await expectStatus(`/video-delivery/playback/${video.id}`, other, 403);
  const staleAdmin = jwt.sign({ sub: other.id, role: 'ADMIN' }, process.env.JWT_SECRET || 'secretKey', { expiresIn: '10m' });
  await expectStatus(`/video-delivery/playback/${video.id}`, undefined, 403, { headers: { Authorization: `Bearer ${staleAdmin}` } });
  const imageBypass = await request(`/files/resolved-image?url=${encodeURIComponent(videoSource)}`);
  assert.ok([400, 403, 404].includes(imageBypass.status), 'Image proxy must not return private video bytes');
  cases.push('Real MP4: paid native video Range206, other account and stale admin token denied, image proxy denied');
  const book = await db.audiobook.create({ data: { title: prefix, author: prefix, authorId: owner.id, isMonetized: true, price: 100, chapters: { create: { title: prefix, duration: 1, audioUrl: source, text: 'fixture private text' } } } }); ids.books.push(book.id);
  const locked = await (await expectStatus(`/audiobooks/${book.id}`, undefined, 200)).json();
  assert.equal(locked.chapters[0].text, null);
  await purchase(buyer, 'AUDIOBOOK', book.id);
  const unlocked = await (await expectStatus(`/audiobooks/${book.id}`, buyer, 200)).json();
  assert.equal(unlocked.chapters[0].text, 'fixture private text');
  cases.push('Book text hidden publicly and readable by recorded buyer');
  const course = await db.academicCourse.create({ data: { title: prefix, instructorId: owner.id, isMonetized: true, price: 100, modules: { create: { title: prefix, lessons: { create: { title: prefix, contentType: 'AUDIO', contentUrl: source, notes: 'private course notes' } } } } } }); ids.courses.push(course.id);
  const courseLocked = await (await expectStatus(`/academic/courses/${course.id}`, buyer, 200)).json();
  assert.equal(courseLocked.hasAccess, false); assert.equal(courseLocked.modules[0].lessons[0].contentUrl, undefined);
  await expectStatus(`/academic/courses/${course.id}/enroll`, buyer, 403, { method: 'POST' });
  await purchase(buyer, 'COURSE', course.id);
  const courseUnlocked = await (await expectStatus(`/academic/courses/${course.id}`, buyer, 200)).json();
  assert.equal(courseUnlocked.hasAccess, true); assert.ok(courseUnlocked.modules[0].lessons[0].contentUrl.includes('/content-access/stream?ticket='));
  await expectStatus(`/academic/courses/${course.id}/enroll`, buyer, 201, { method: 'POST' });
  await expectStatus('/academic/courses', owner, 403, { method: 'POST', body: JSON.stringify({ title: prefix }) });
  cases.push('Paid course: protected lessons, enrollment after purchase, role without active trainer subscription denied publication');
  const library = await (await expectStatus('/monetization/my-purchases', buyer, 200)).json();
  assert.deepEqual(library.map(p => p.contentType).sort(), ['ALBUM', 'AUDIOBOOK', 'COURSE', 'SONG', 'VIDEO']);
  assert.ok(library.every(p => p.details && p.pricePaid === 100));
  await expectStatus('/monetization/admin/config', other, 403);
  cases.push('Typed purchases and details persist across requests; member denied financial configuration');
  console.log(JSON.stringify({ result: 'PASS', cases }, null, 2));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  await db.courseEnrollment.deleteMany({ where: { courseId: { in: ids.courses } } });
  await db.academicCourse.deleteMany({ where: { id: { in: ids.courses } } });
  await db.audiobook.deleteMany({ where: { id: { in: ids.books } } });
  await db.video.deleteMany({ where: { id: { in: ids.videos } } });
  await db.song.deleteMany({ where: { id: { in: ids.songs } } });
  await db.album.deleteMany({ where: { id: { in: ids.albums } } });
  await db.user.deleteMany({ where: { id: { in: ids.users } } });
  await db.artist.deleteMany({ where: { id: { in: ids.artists } } });
  await storage.removeObject(bucket, object).catch(() => {});
  await storage.removeObject(videoBucket, videoObject).catch(() => {});
  if (fs.existsSync(videoTemp)) fs.unlinkSync(videoTemp);
  await db.$disconnect();
});
