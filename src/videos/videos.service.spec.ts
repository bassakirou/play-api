import { VideosService } from './videos.service';
import { VideoDeliveryService } from '../video-delivery/video-delivery.service';

describe('Video taxonomy updates', () => {
  it('does not invent or persist an owner when listing an unowned video', async () => {
    const db: any = {
      video: {
        findMany: jest.fn(async () => [{ id: 'legacy', userId: null, user: null, videoUrl: 'legacy.mp4' }]),
        update: jest.fn(),
      },
      user: { findFirst: jest.fn(async () => ({ id: 'unrelated-admin', email: 'admin@example.com' })) },
    };
    const service = new VideosService(db, { refreshUrl: (url: string) => url } as any, {} as any);
    const [video] = await service.findAllAdmin({ role: 'ADMIN' });
    expect(video.user).toBeNull();
    expect(video.userId).toBeNull();
    expect(db.video.update).not.toHaveBeenCalled();
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });

  function fixture() {
    const existing = {
      id: 'video-1', userId: 'owner', title: 'Le recouvrement en entreprise',
      videoUrl: 'original.mp4', category: 'Business', tags: ['Recouvrement'],
      isPublished: false, publishWhenReady: false, mediaAssetId: null,
      user: { id: 'owner', artistProfile: { id: 'channel-1', name: 'AKIROU' } },
    };
    const update = jest.fn(async ({ data }) => ({ ...existing, ...data, videoTags: [] }));
    const db: any = {
      video: { findUnique: jest.fn(async () => existing), update },
      videoCategory: { upsert: jest.fn(async () => ({ id: 'business', name: 'Business' })) },
      videoTag: { upsert: jest.fn(async ({ create }) => ({ id: create.normalizedName, ...create })) },
    };
    const service = new VideosService(db, { refreshUrl: (url: string) => url } as any, {
      preparePublication: async (_asset: unknown, requested: boolean) => ({
        mediaAssetId: null, isPublished: requested, publishWhenReady: false,
      }),
      sourceReference: async (_id: string, _asset: unknown, fallback: string) => fallback,
    } as any);
    return { service, db, update };
  }

  it.each([
    { tags: ['Recouvrement'] },
    { tags: ['Gestion', 'Finance'] },
    { tags: [] },
  ])('saves publication and replaces tag links for $tags', async ({ tags }) => {
    const f = fixture();
    await f.service.update('video-1', { category: 'Business', tags, isPublished: true }, { id: 'owner', role: 'CREATOR' });
    expect(f.update).toHaveBeenCalledTimes(1);
    expect(f.update.mock.calls[0][0].data).toMatchObject({
      isPublished: true,
      tags,
      videoTags: {
        deleteMany: {},
        create: tags.map(tag => ({ tag: { connect: { id: tag.toLowerCase() } } })),
      },
    });
  });

  it('retains current tags when only the category is submitted', async () => {
    const f = fixture();
    await f.service.update('video-1', { category: 'Business' }, { role: 'ADMIN' });
    expect(f.update.mock.calls[0][0].data.videoTags.create).toEqual([
      { tag: { connect: { id: 'recouvrement' } } },
    ]);
  });

  it('leaves tag links untouched when taxonomy is omitted', async () => {
    const f = fixture();
    await f.service.update('video-1', { title: 'Nouveau titre' }, { role: 'ADMIN' });
    expect(f.update.mock.calls[0][0].data).not.toHaveProperty('videoTags');
    expect(f.db.videoTag.upsert).not.toHaveBeenCalled();
  });
});

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
