import { VideosService } from './videos.service';
import { VideoDeliveryService } from '../video-delivery/video-delivery.service';

describe('Shared hybrid video publication', () => {
  function fixture(cloud = false) {
    let saved: any;
    let job: any = null;
    const asset = {
      id: 'asset-1',
      userId: 'owner',
      type: 'video',
      fileUrl: 'http://localhost:9000/videos/original.mp4',
      originalBucket: 'videos',
      originalObject: 'original.mp4',
    };
    const user = {
      id: 'owner',
      name: 'Owner',
      email: 'owner@test.local',
      artistProfile: { id: 'channel-1', name: 'Channel' },
    };
    const db: any = {
      artist: { findUnique: async () => ({ id: 'channel-1' }) },
      mediaAsset: { findUnique: async () => asset },
      videoDelivery: {
        findUnique: async () => job,
        upsert: async ({ create }: any) => (job ||= { id: 'job-1', ...create }),
      },
      video: {
        create: async ({ data }: any) => {
          saved = { ...data, user, mediaAsset: { ...asset, delivery: job } };
          return saved;
        },
        findMany: async ({ where }: any) => !where?.userId || where.userId === saved?.userId ? [saved] : [],
      },
    };
    const minio: any = { refreshUrl: (url: string) => url };
    const delivery = new VideoDeliveryService(db, minio, {
      isEnabled: () => cloud,
    } as any);
    const service = new VideosService(db, minio, delivery);
    return { service, saved: () => saved };
  }
  const input: any = {
    title: 'Test video',
    videoUrl: 'http://localhost:9000/videos/hls/master.m3u8',
    mediaAssetId: 'asset-1',
    duration: 60,
    isPublished: true,
  };

  it.each(['create', 'createForUser'] as const)(
    'retains MinIO playback and a valid free price on %s when Cloudflare is disabled',
    async (method) => {
      const f = fixture();
      if (method === 'create')
        await f.service.create(input, 'owner', 'CREATOR');
      else await f.service.createForUser('owner', input, 'CREATOR');
      expect(f.saved()).toMatchObject({
        mediaAssetId: 'asset-1',
        isPublished: true,
        publishWhenReady: false,
        price: 0,
      });
      expect(f.saved().videoUrl).toBe(
        'http://localhost:9000/videos/hls/master.m3u8',
      );
    },
  );

  it('records publication intent, stores a safe reference and keeps original metadata out of public responses', async () => {
    const f = fixture(true);
    await f.service.create(input, 'owner', 'ADMIN');
    expect(f.saved()).toMatchObject({
      mediaAssetId: 'asset-1',
      isPublished: false,
      publishWhenReady: true,
    });
    expect(f.saved().videoUrl).toMatch(/^pyramidplay:video:/);
    const [publicVideo] = await f.service.findAll();
    expect(publicVideo.mediaAsset).toBeUndefined();
    expect(publicVideo.mediaAssetId).toBeUndefined();
    expect(JSON.stringify(publicVideo)).not.toContain('original.mp4');
  });

  it('does not expose another creator’s original through the administrative list', async () => {
    const f = fixture(true);
    await f.service.create(input, 'owner', 'CREATOR');
    expect(await f.service.findAllAdmin({ id: 'other', role: 'CREATOR' })).toEqual([]);
    expect(await f.service.findAllAdmin({ id: 'admin', role: 'ADMIN' })).toHaveLength(1);
  });
});
