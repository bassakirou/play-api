import { ForbiddenException } from '@nestjs/common';
import { LivesService } from './lives.service';

describe('Live delivery', () => {
  function fixture() {
    const live = {
      id: 'live-id', userId: 'owner', isPrivate: true, accessKey: 'invite',
      status: 'LIVE', streamUrl: null, recordingUrl: null, cloudflareInputId: 'remote-input',
      cleanupAt: new Date(Date.now() + 120_000), retentionDays: 3,
      comments: [], reactions: [],
    };
    const prisma = {
      liveStream: {
        findUnique: jest.fn().mockResolvedValue(live),
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      videoRoutingPolicy: { findUnique: jest.fn().mockResolvedValue(null) },
      userPurchasedContent: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const minio = {
      presignGet: jest.fn().mockResolvedValue('https://storage.test/temporary-source'),
      removeObject: jest.fn(),
    };
    const cloudflare = {
      isEnabled: jest.fn().mockReturnValue(true),
      livePlaybackUrl: jest.fn().mockResolvedValue('https://customer-test.cloudflarestream.com/token/webRTC/play'),
      playback: jest.fn(),
      findCopy: jest.fn().mockResolvedValue(null),
      copy: jest.fn(),
      deleteLiveInput: jest.fn(),
      deleteVideo: jest.fn(),
    };
    const service = new LivesService(prisma as any, minio as any, cloudflare as any, {} as any);
    return { live, prisma, minio, cloudflare, service };
  }

  it('authorizes a private viewer before generating a signed playback URL', async () => {
    const { service, cloudflare } = fixture();
    await expect(service.findOne('live-id')).rejects.toBeInstanceOf(ForbiddenException);
    expect(cloudflare.livePlaybackUrl).not.toHaveBeenCalled();
    await expect(service.findOne('live-id', 'invite')).resolves.toMatchObject({
      whepUrl: expect.stringContaining('/token/webRTC/play'),
    });
    expect(cloudflare.livePlaybackUrl).toHaveBeenCalledWith('remote-input', true);
  });

  it('keeps the protected fallback if the Cloudflare replay token fails', async () => {
    const { live, prisma, cloudflare, service } = fixture();
    prisma.liveStream.findUnique.mockResolvedValue({
      ...live, status: 'REPLAY', replaySourceObject: 'lives/recordings/source.webm',
      cloudflareReplayId: 'replay-id', cloudflareReplayStatus: 'READY',
    });
    cloudflare.playback.mockRejectedValue(new Error('offline'));
    await expect(service.findOne('live-id', 'invite')).resolves.toMatchObject({
      recordingUrl: 'https://storage.test/temporary-source',
      replayCloudflareUrl: undefined,
    });
  });

  it('returns the offer but issues a signed direct link only to its buyer', async () => {
    const { live, prisma, service, cloudflare } = fixture();
    prisma.liveStream.findUnique.mockResolvedValue({ ...live, isPrivate: false, livePrice: 1000 });
    await expect(service.findOne('live-id', undefined, undefined, 'buyer')).resolves.toMatchObject({
      hasPlaybackAccess: false, livePrice: 1000, whepUrl: undefined,
    });
    expect(cloudflare.livePlaybackUrl).not.toHaveBeenCalled();
    prisma.userPurchasedContent.findUnique.mockResolvedValue({ id: 'ticket' });
    await expect(service.findOne('live-id', undefined, undefined, 'buyer', false)).resolves.toMatchObject({ hasPlaybackAccess: true, whepUrl: undefined });
    expect(prisma.userPurchasedContent.findUnique).toHaveBeenCalledWith({ where: { userId_contentId_contentType: {
      userId: 'buyer', contentId: 'live-id', contentType: 'LIVE',
    } } });
    await service.findOne('live-id', undefined, undefined, 'buyer');
    expect(cloudflare.livePlaybackUrl).toHaveBeenCalledWith('remote-input', true);
  });

  it('checks replay rights separately and caps both links at the purchased expiration', async () => {
    const { live, prisma, minio, cloudflare, service } = fixture();
    prisma.liveStream.findUnique.mockResolvedValue({ ...live, isPrivate: false, status: 'REPLAY', replayPrice: 1500,
      cleanupAt: null, replaySourceObject: 'lives/recordings/source.webm', cloudflareReplayId: 'replay-id', cloudflareReplayStatus: 'READY' });
    const end = Math.floor(Date.now() / 1000) + 60;
    prisma.userPurchasedContent.findUnique.mockImplementation(async ({ where }) =>
      where.userId_contentId_contentType.contentType === 'LIVE' ? { id: 'direct-ticket' } : null);
    await expect(service.findOne('live-id', undefined, undefined, 'buyer')).resolves.toMatchObject({ hasPlaybackAccess: false, recordingUrl: null });
    expect(minio.presignGet).not.toHaveBeenCalled();
    prisma.userPurchasedContent.findUnique.mockResolvedValue({ accessEndsAt: new Date(end * 1000) });
    cloudflare.playback.mockResolvedValue({ url: 'signed' });
    await expect(service.findOne('live-id', undefined, undefined, 'buyer')).resolves.toMatchObject({ hasPlaybackAccess: true, replayCloudflareUrl: 'signed', playbackExpiresAt: end });
    expect(cloudflare.playback).toHaveBeenCalledWith('replay-id', end);
    expect(minio.presignGet.mock.calls[0][0].expiresSeconds).toBeLessThanOrEqual(60);
    prisma.userPurchasedContent.findUnique.mockResolvedValue({ accessEndsAt: new Date(Date.now() - 1000) });
    await expect(service.findOne('live-id', undefined, undefined, 'buyer')).resolves.toMatchObject({ hasPlaybackAccess: false, recordingUrl: null });
  });

  it('promotes a retained replay only after Stream has encoded it', async () => {
    const { live, prisma, cloudflare, service } = fixture();
    const source = 'lives/recordings/source.webm';
    prisma.liveStream.findMany.mockResolvedValue([
      { ...live, status: 'REPLAY', replaySourceObject: source },
    ]);
    cloudflare.copy.mockResolvedValue({
      uid: 'replay-id', readyToStream: false, status: { state: 'inprogress' },
    });
    await service.syncCloudflareReplays();
    expect(cloudflare.copy).toHaveBeenCalledWith('https://storage.test/temporary-source', 'live-replay-source.webm');
    expect(prisma.liveStream.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { cloudflareReplayId: 'replay-id', cloudflareReplayStatus: 'PENDING' },
    }));
  });

  it('deletes both copies of an expired replay', async () => {
    const { live, prisma, cloudflare, minio, service } = fixture();
    const source = 'lives/recordings/source.webm';
    prisma.liveStream.findMany.mockResolvedValueOnce([
      { ...live, replaySourceObject: source, cloudflareReplayId: 'replay-id' },
    ]).mockResolvedValue([]);
    await expect(service.cleanupExpiredLives()).resolves.toEqual({ cleanedCount: 1 });
    expect(cloudflare.deleteVideo).toHaveBeenCalledWith('replay-id');
    expect(minio.removeObject).toHaveBeenCalledWith('videos', source, true);
    expect(prisma.liveStream.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'ENDED', isCleanedUp: true }),
    }));
  });
});
