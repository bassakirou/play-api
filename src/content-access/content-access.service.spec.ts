import { ContentAccessService } from './content-access.service';

describe('Content access and media tickets', () => {
  const make = () => {
    const db: any = {
      song: { findUnique: jest.fn(async () => ({ id: 'song', audioUrl: 'http://localhost:9000/audio/a.mp3', isMonetized: true, price: 100, artists: [{ userId: 'owner' }], album: null })) },
      audiobook: { findUnique: jest.fn(async () => ({ id: 'book', authorId: 'author', isMonetized: true, price: 100, chapters: [{ id: 'chapter', audioUrl: '/uploads/audio/book.mp3', text: 'secret' }] })) },
      user: { findUnique: jest.fn(async () => ({ role: { name: 'MEMBER' }, systemRoles: [] })) },
      userPurchasedContent: { findUnique: jest.fn(async () => null) },
    };
    return { db, service: new ContentAccessService(db) };
  };
  it('denies paid audio to visitors and unrelated accounts', async () => {
    const { service } = make();
    await expect(service.playback('SONG', 'song')).rejects.toThrow();
    await expect(service.playback('SONG', 'song', { id: 'other' })).rejects.toThrow();
  });
  it('issues a bounded ticket after checking the recorded typed purchase', async () => {
    const { service, db } = make();
    db.userPurchasedContent.findUnique.mockImplementation(async ({ where }: any) => where.userId_contentId_contentType.contentType === 'SONG' ? { id: 'purchase' } : null);
    const result = await service.playback('SONG', 'song', { id: 'buyer' });
    const token = new URL(result.url, 'http://localhost').searchParams.get('ticket')!;
    expect(service.verifyTicket(token).contentId).toBe('song');
    expect(() => service.verifyTicket(token + 'x')).toThrow();
    expect(result.expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 7200);
  });
  it('requires a paid parent album for otherwise free album tracks', async () => {
    const { service, db } = make();
    db.song.findUnique.mockResolvedValue({ id: 'song', audioUrl: '/audio/a.mp3', price: 0, isMonetized: false, artists: [], albumId: 'album', album: { id: 'album', isMonetized: true, price: 500 } });
    await expect(service.playback('SONG', 'song')).rejects.toThrow();
    db.userPurchasedContent.findUnique.mockImplementation(async ({ where }: any) => where.userId_contentId_contentType.contentType === 'ALBUM' ? { id: 'purchase' } : null);
    await expect(service.playback('SONG', 'song', { id: 'buyer' })).resolves.toHaveProperty('url');
  });
  it('redacts paid text and original URLs even when nested in search or purchases', async () => {
    const { service, db } = make();
    const result = await service.sanitize({ songs: [await db.song.findUnique()], book: await db.audiobook.findUnique() });
    expect(result.songs[0].audioUrl).toBe('pyramidplay:audio:SONG:song');
    expect(result.book.chapters[0].text).toBeNull();
    expect(result.book.chapters[0].audioUrl).toBe('pyramidplay:audio:AUDIOBOOK:book:chapter');
  });
  it('preserves readable text for the author and a verified purchaser', async () => {
    const { service, db } = make();
    const book = await db.audiobook.findUnique();
    expect((await service.sanitize(book, { id: 'author' })).chapters[0].text).toBe('secret');
    db.userPurchasedContent.findUnique.mockResolvedValue({ id: 'purchase' });
    expect((await service.sanitize(book, { id: 'buyer' })).chapters[0].text).toBe('secret');
  });
  it('bounds HLS segments to the signed source directory and rejects remote URLs', () => {
    const { service } = make();
    expect(service.segmentSource('http://localhost:9000/audio/set/master.m3u8', 'track/segment.ts')).toBe('http://localhost:9000/audio/set/track/segment.ts');
    for (const path of ['../secret.mp3', '%2e%2e/secret', 'https://evil.test/x', '//evil/x', '/audio/other']) {
      expect(() => service.segmentSource('http://localhost:9000/audio/set/master.m3u8', path)).toThrow();
    }
  });
});
