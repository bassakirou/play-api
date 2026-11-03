import { VideoDeliveryService } from './video-delivery.service';

describe('Cloudflare first with protected local failover', () => {
  function fixture() {
    const video = { id: 'v', userId: 'owner', isPublished: true, isMonetized: true, price: 100, mediaAsset: { fileUrl: 'http://localhost:9000/videos/original.mp4', originalBucket: 'videos', originalObject: 'original.mp4', delivery: { status: 'READY', remoteUid: 'remote' } } };
    const db: any = { video: { findUnique: jest.fn().mockResolvedValue(video) }, userPurchasedContent: { findUnique: jest.fn().mockResolvedValue(null) }, videoRoutingPolicy: { findUnique: jest.fn().mockResolvedValue(null) }, videoMonitorSample: { findFirst: jest.fn().mockResolvedValue(null) } };
    const cf: any = { isEnabled: () => true, playback: jest.fn().mockResolvedValue({ url: 'https://customer-test.cloudflarestream.com/token/manifest/video.m3u8', expiresAt: Date.now() / 1000 + 3600 }) };
    const minio: any = { objectExists: jest.fn().mockResolvedValue(true) };
    const access: any = { isAdmin: jest.fn().mockResolvedValue(false), playback: jest.fn().mockResolvedValue({ url: '/content-access/stream?ticket=signed', format: 'file', expiresAt: Date.now() / 1000 + 7200 }) };
    return { db, cf, minio, access, service: new VideoDeliveryService(db, minio, cf, access) };
  }
  it('prefers Cloudflare when ready', async () => { const f = fixture(); expect((await f.service.playback('v', { id: 'owner' })).url).toContain('cloudflarestream'); expect(f.access.playback).not.toHaveBeenCalled(); });
  it('uses a protected local ticket on provider failure', async () => { const f = fixture(); f.cf.playback.mockRejectedValue(new Error('offline')); expect(await f.service.playback('v', { id: 'owner' })).toMatchObject({ provider: 'MINIO', url: '/content-access/stream?ticket=signed' }); });
  it('honors the persistent manual local mode', async () => { const f = fixture(); f.db.videoRoutingPolicy.findUnique.mockResolvedValue({ mode: 'LOCAL_ONLY' }); await f.service.playback('v', { id: 'owner' }); expect(f.cf.playback).not.toHaveBeenCalled(); });
  it('never bypasses payment checks when the client requests local', async () => { const f = fixture(); await expect(f.service.playback('v', { id: 'stranger' }, true)).rejects.toThrow(); expect(f.access.playback).not.toHaveBeenCalled(); });
  it('refuses a missing original', async () => { const f = fixture(); f.minio.objectExists.mockResolvedValue(false); await expect(f.service.playback('v', { id: 'owner' }, true)).rejects.toThrow('Original local indisponible'); });
  it('does not overload a known saturated local server', async () => { const f = fixture(); f.db.videoMonitorSample.findFirst.mockResolvedValue({ cpuPercent: 98 }); await expect(f.service.playback('v', { id: 'owner' }, true)).rejects.toThrow('saturé'); });
  it('opens a short circuit after repeated API failures', async () => { const f = fixture(); f.cf.playback.mockRejectedValue(new Error('offline')); for (let i = 0; i < 4; i++) await f.service.playback('v', { id: 'owner' }); expect(f.cf.playback).toHaveBeenCalledTimes(3); });
});
