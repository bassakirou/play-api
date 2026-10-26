import { VideoDeliveryService } from './video-delivery.service';

describe('Hybrid publication and playback', () => {
  const source = {
    id: 'asset-1',
    type: 'video',
    userId: 'owner',
    originalBucket: 'videos',
    originalObject: 'source.mp4',
  };
  const make = (enabled = true) => {
    let job: any = null;
    const db: any = {
      mediaAsset: { findUnique: async () => source },
      videoDelivery: {
        upsert: async ({ create }: any) => (job ||= { id: 'job-1', ...create }),
        findUnique: async () => job,
        updateMany: async ({ where, data }: any) => {
          if (!job || (where.status && job.status !== where.status))
            return { count: 0 };
          job = { ...job, ...data };
          return { count: 1 };
        },
      },
      video: {
        findFirst: async () => null,
        findUnique: async () => ({
          id: 'video-1',
          userId: 'owner',
          isPublished: true,
          isMonetized: true,
          price: 1000,
          mediaAsset: { delivery: { status: 'READY', remoteUid: 'remote-1' } },
        }),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      userPurchasedContent: { findUnique: async () => null },
    };
    const provider: any = {
      isEnabled: () => enabled,
      configuration: () => ({ configured: enabled }),
      playback: async () => ({
        url: 'https://customer-test.cloudflarestream.com/token/manifest/video.m3u8',
        expiresAt: 1234,
      }),
    };
    const service = new VideoDeliveryService(
      db,
      { presignGet: async () => 'https://media.test/signed' } as any,
      provider,
    );
    return { service, db, provider, getJob: () => job };
  };

  it('keeps the current publication path when Cloudflare is disabled', async () => {
    const { service, getJob } = make(false);
    expect(
      await service.preparePublication('asset-1', true, {
        id: 'owner',
        role: 'CREATOR',
      }),
    ).toEqual({
      mediaAssetId: 'asset-1',
      isPublished: true,
      publishWhenReady: false,
    });
    expect(getJob()).toBeNull();
  });

  it('rejects using another creator’s original, even when cloud delivery is disabled', async () => {
    const { service } = make(false);
    await expect(
      service.preparePublication('asset-1', true, {
        id: 'other',
        role: 'CREATOR',
      }),
    ).rejects.toThrow();
  });

  it('lets an admin publish from a creator’s source and retains the publication intent while processing', async () => {
    const { service, getJob } = make();
    expect(
      await service.preparePublication('asset-1', true, {
        id: 'admin',
        role: 'ADMIN',
      }),
    ).toMatchObject({ isPublished: false, publishWhenReady: true });
    expect(getJob()).toMatchObject({
      mediaAssetId: 'asset-1',
      status: 'QUEUED',
    });
  });

  it('does not grant a paid playback link to an anonymous or non-purchasing viewer', async () => {
    const { service } = make();
    await expect(service.playback('video-1')).rejects.toThrow();
    await expect(
      service.playback('video-1', { id: 'viewer' }),
    ).rejects.toThrow();
    await expect(
      service.playback('video-1', { id: 'owner' }),
    ).resolves.toHaveProperty('url');
  });

  it('grants paid playback only after checking the recorded purchase', async () => {
    const { service, db } = make();
    db.userPurchasedContent.findUnique = async ({ where }: any) => {
      expect(where).toEqual({
        userId_contentId_contentType: {
          userId: 'buyer',
          contentId: 'video-1',
          contentType: 'VIDEO',
        },
      });
      return { id: 'purchase-1' };
    };
    await expect(
      service.playback('video-1', { id: 'buyer' }),
    ).resolves.toHaveProperty('url');
  });

  it('does not publish a draft when a ready notification arrives', async () => {
    const { service, db } = make();
    await service.preparePublication('asset-1', false, { id: 'owner' });
    await service.reconcile('job-1', {
      uid: 'remote-1',
      readyToStream: true,
      status: { state: 'ready', pctComplete: '100' },
    });
    expect(db.video.updateMany).toHaveBeenCalledWith({
      where: { mediaAssetId: 'asset-1', publishWhenReady: true },
      data: { isPublished: true, publishWhenReady: false },
    });
  });

  it('stores a playback reference instead of leaking an original through playlists and purchases', async () => {
    const { service } = make();
    await service.preparePublication('asset-1', true, { id: 'owner' });
    expect(
      await service.sourceReference(
        'video-1',
        'asset-1',
        'https://media.test/videos/original.mp4',
      ),
    ).toBe('pyramidplay:video:video-1');
  });

  it('waits for all encodings before publishing and ignores an older failure after READY', async () => {
    const { service, getJob } = make();
    await service.preparePublication('asset-1', true, { id: 'owner' });
    await service.reconcile('job-1', {
      uid: 'remote-1',
      readyToStream: true,
      status: { state: 'ready', pctComplete: '39' },
    });
    expect(getJob().status).toBe('PROCESSING');
    await service.reconcile('job-1', {
      uid: 'remote-1',
      readyToStream: true,
      status: { state: 'ready', pctComplete: '100' },
    });
    await service.reconcile('job-1', {
      uid: 'remote-1',
      readyToStream: false,
      status: { state: 'error' },
    });
    expect(getJob().status).toBe('READY');
  });

  it('does not grant draft access to a buyer who is neither owner nor admin', async () => {
    const { service, db } = make();
    db.video.findUnique = async () => ({
      id: 'video-1',
      userId: 'owner',
      isPublished: false,
      isMonetized: false,
    });
    await expect(service.playback('video-1', { id: 'viewer' })).rejects.toThrow(
      'Vidéo indisponible',
    );
  });

  it('does not reuse an authorized user’s token for an unauthorized viewer', async () => {
    const { service } = make();
    await service.playback('video-1', { id: 'owner' });
    await expect(
      service.playback('video-1', { id: 'viewer' }),
    ).rejects.toThrow();
  });
});
