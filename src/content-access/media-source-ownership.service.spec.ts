import { MediaSourceOwnershipService } from './media-source-ownership.service';
import { ForbiddenException } from '@nestjs/common';

describe('Private media source ownership', () => {
  let service: MediaSourceOwnershipService;
  let prisma: any;
  beforeEach(() => {
    prisma = {
      mediaAsset: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    service = new MediaSourceOwnershipService(prisma, {
      isAdmin: async () => false,
    } as any);
  });
  it('rejects known old URLs rebound as new free content', async () => {
    await expect(
      service.resolve(
        'https://media.pyramidplay.cm/audio/victim.mp3?signature=old',
        'attacker',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('allows an unchanged same item source without a legacy upload row', async () => {
    await expect(
      service.resolve(
        'https://media.pyramidplay.cm/audio/old.mp3?x=1',
        'owner',
        'http://localhost:9000/audio/old.mp3',
      ),
    ).resolves.toContain('old.mp3');
  });
  it('compares owned internal sources by canonical path, ignoring legacy host and signature', async () => {
    prisma.mediaAsset.findMany.mockResolvedValue([
      { fileUrl: 'http://localhost:9000/audio/owned.mp3?old=1' },
    ]);
    await expect(
      service.resolve(
        'https://media.pyramidplay.cm/audio/owned.mp3?new=1',
        'owner',
      ),
    ).resolves.toContain('owned.mp3');
  });
  it('rejects unbound local uploads and private blob sources', async () => {
    await expect(
      service.resolve('/uploads/victim.mp3', 'attacker'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.resolve(
        'https://store.private.blob.vercel-storage.com/victim.mp3',
        'attacker',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('does not confuse private blobs from different stores with the same path', async () => {
    prisma.mediaAsset.findMany.mockResolvedValue([
      { fileUrl: 'https://own.private.blob.vercel-storage.com/song.mp3' },
    ]);
    await expect(
      service.resolve(
        'https://victim.private.blob.vercel-storage.com/song.mp3',
        'owner',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('resolves a sourceRef only when the asset is owned', async () => {
    prisma.mediaAsset.findUnique.mockResolvedValue({
      userId: 'owner',
      fileUrl: '/uploads/owned.mp3',
    });
    await expect(
      service.resolve('pyramidplay:asset:asset', 'owner'),
    ).resolves.toBe('/uploads/owned.mp3');
    await expect(
      service.resolve('pyramidplay:asset:asset', 'attacker'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('uses a stream ASSET payload only as an untrusted asset id and checks the DB owner', async () => {
    prisma.mediaAsset.findUnique.mockResolvedValue({
      userId: 'owner',
      fileUrl: '/uploads/owned.mp3',
    });
    const ticket =
      Buffer.from(
        JSON.stringify({
          type: 'ASSET',
          contentId: 'asset',
          userId: 'attacker',
        }),
      ).toString('base64url') + '.untrusted';
    await expect(
      service.resolve(
        `https://api.example.com/content-access/stream?ticket=${ticket}`,
        'owner',
      ),
    ).resolves.toBe('/uploads/owned.mp3');
    await expect(
      service.resolve(`/content-access/stream?ticket=${ticket}`, 'attacker'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects a non-ASSET stream ticket as a reusable media selection', async () => {
    const ticket =
      Buffer.from(
        JSON.stringify({ type: 'SONG', contentId: 'victim' }),
      ).toString('base64url') + '.untrusted';
    await expect(
      service.resolve(`/content-access/stream?ticket=${ticket}`, 'attacker'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
