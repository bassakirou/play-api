import { ContentWriteGuard } from './content-write.guard';
import { sign } from 'jsonwebtoken';
import { ForbiddenException, BadRequestException } from '@nestjs/common';

describe('ContentWriteGuard', () => {
  let prisma: any;
  let subscriptions: any;
  let guard: ContentWriteGuard;
  let request: any;
  const run = () =>
    guard.canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
    } as any);
  beforeEach(() => {
    prisma = {
      mediaAsset: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ systemRoles: [] }) },
      artist: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'owner' }),
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'artist', userId: 'owner' }),
      },
      song: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'song',
          artists: [{ userId: 'owner' }],
          audioUrl: 'private.mp3',
          isMonetized: false,
        }),
      },
      album: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'album', artist: { userId: 'owner' } }),
      },
      video: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'video', userId: 'owner' }),
      },
      audiobook: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'book',
          authorId: 'owner',
          chapters: [{ id: 'chapter', audioUrl: 'chapter.mp3' }],
        }),
      },
    };
    subscriptions = {
      isAdmin: jest.fn().mockResolvedValue(false),
      assertCanPublish: jest.fn().mockResolvedValue(undefined),
    };
    guard = new ContentWriteGuard(prisma, subscriptions, {
      get: () => 'test-key',
    } as any);
    request = {
      method: 'PATCH',
      path: '/songs/song',
      body: {},
      headers: {
        authorization: `Bearer ${sign({ sub: 'owner' }, 'test-key')}`,
      },
    };
  });
  it('rejects another user despite a forged request user property', async () => {
    request.user = { id: 'owner', role: 'ADMIN' };
    request.headers.authorization = `Bearer ${sign({ sub: 'stranger', role: 'ADMIN' }, 'test-key')}`;
    await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each([
    '/songs/song',
    '/albums/album',
    '/videos/video',
    '/audiobooks/book',
    '/audiobooks/book/chapters/chapter',
    '/audiobooks/book/chapters/chapter/sync',
  ])('checks owner for %s', async (path) => {
    request.path = path;
    request.headers.authorization = `Bearer ${sign({ sub: 'stranger' }, 'test-key')}`;
    await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('checks the existing academic marker even when update removes it', async () => {
    prisma.song.findUnique.mockResolvedValue({
      artists: [{ userId: 'owner' }],
      isAcademic: true,
    });
    request.body = { isAcademic: false };
    subscriptions.assertCanPublish.mockRejectedValue(new ForbiddenException());
    await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('checks publication subscription when creating academic content', async () => {
    request.method = 'POST';
    request.path = '/videos/me';
    request.body = { isAcademic: true };
    subscriptions.assertCanPublish.mockRejectedValue(new ForbiddenException());
    await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('restores only the same song protected reference', async () => {
    request.body = { audioUrl: 'pyramidplay:audio:SONG:song' };
    await run();
    expect(request.body.audioUrl).toBe('private.mp3');
  });
  it('rejects references to a different song', async () => {
    request.body = { audioUrl: 'pyramidplay:audio:SONG:other' };
    await expect(run()).rejects.toBeInstanceOf(BadRequestException);
  });
  it('restores chapter references using chapter identity', async () => {
    request.path = '/audiobooks/book';
    request.body = {
      chapters: [
        { id: 'chapter', audioUrl: 'pyramidplay:audio:AUDIOBOOK:book:chapter' },
      ],
    };
    await run();
    expect(request.body.chapters[0].audioUrl).toBe('chapter.mp3');
  });
  it('rejects cross chapter references', async () => {
    request.path = '/audiobooks/book/chapters/other';
    request.body = { audioUrl: 'pyramidplay:audio:AUDIOBOOK:book:chapter' };
    await expect(run()).rejects.toBeInstanceOf(BadRequestException);
  });
  it('binds a created book to the current user', async () => {
    request.method = 'POST';
    request.path = '/audiobooks';
    await run();
    expect(request.body.authorId).toBe('owner');
    request.body = { authorId: 'stranger' };
    await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each([
    { isMonetized: true, price: 0 },
    { price: -1 },
    { price: 1.5 },
    { price: 200, discountPrice: 200 },
    { price: 200, discountPrice: 0 },
    { price: '200' },
    { isMonetized: 'false' },
    { discountPrice: 100 },
  ])('rejects invalid price configuration %j', async (body) => {
    request.body = body;
    await expect(run()).rejects.toBeInstanceOf(BadRequestException);
  });
  it('validates a partial price update against the persisted discount', async () => {
    prisma.song.findUnique.mockResolvedValue({
      artists: [{ userId: 'owner' }],
      isMonetized: true,
      price: 500,
      discountPrice: 400,
    });
    request.body = { price: 300 };
    await expect(run()).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each([
    '/songs/song/play',
    '/videos/video/metrics',
    '/audiobooks/tts/preview',
  ])('preserves unrelated operation %s', async (path) => {
    request.path = path;
    request.headers = {};
    await expect(run()).resolves.toBe(true);
  });
  it('rejects a token signed by a different secret', async () => {
    request.headers.authorization = `Bearer ${sign({ sub: 'owner' }, 'wrong-secret')}`;
    await expect(run()).rejects.toThrow('Authentification');
  });
  it('allows a verified database administrator to edit another owner content', async () => {
    prisma.user.findUnique.mockResolvedValue({ systemRoles: ['SUPER_ADMIN'] });
    request.headers.authorization = `Bearer ${sign({ sub: 'administrator' }, 'test-key')}`;
    await expect(run()).resolves.toBe(true);
  });
  it('requires ownership of an album when attaching a song', async () => {
    request.body = { albumId: 'other-album' };
    prisma.album.findUnique.mockResolvedValue({
      artist: { userId: 'stranger' },
    });
    await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('protects case insensitive Express route matches', async () => {
    request.path = '/API/SONGS/song';
    request.headers.authorization = `Bearer ${sign({ sub: 'stranger' }, 'test-key')}`;
    await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('prevents nulling the book author to discard ownership', async () => {
    request.path = '/audiobooks/book';
    request.body = { authorId: null };
    await run();
    expect(request.body.authorId).toBe('owner');
  });
  it('rejects aliasing known victim private storage into a free song', async () => {
    request.method = 'POST';
    request.path = '/songs';
    request.body = {
      audioUrl: 'https://media.pyramidplay.cm/audio/victim.mp3',
      isMonetized: false,
    };
    await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('accepts an owned media sourceRef on song creation and restores its raw source', async () => {
    request.method = 'POST';
    request.path = '/songs';
    request.body = { audioUrl: 'pyramidplay:asset:owned' };
    prisma.mediaAsset.findUnique.mockResolvedValue({
      userId: 'owner',
      fileUrl: '/uploads/owned.mp3',
    });
    await run();
    expect(request.body.audioUrl).toBe('/uploads/owned.mp3');
  });
});
