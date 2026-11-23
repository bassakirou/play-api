import { isPurchaseActive, validateAccessPeriod } from './access-period';
import { ContentAccessService } from './content-access.service';

describe('purchased access periods', () => {
  const now = new Date('2026-12-15T12:00:00Z');
  it('keeps legacy permanent purchases and closes precisely at expiration', () => {
    expect(isPurchaseActive(null, now)).toBe(false);
    expect(isPurchaseActive({ id: 'legacy' }, now)).toBe(true);
    expect(isPurchaseActive({ accessStartsAt: now, accessEndsAt: new Date(now.getTime() + 1) }, now)).toBe(true);
    expect(isPurchaseActive({ accessEndsAt: now }, now)).toBe(false);
    expect(isPurchaseActive({ accessStartsAt: new Date(now.getTime() + 1) }, now)).toBe(false);
    expect(isPurchaseActive({ accessEndsAt: 'bad date' }, now)).toBe(false);
  });
  it.each([
    { accessMode: 'invalid' },
    { accessMode: 'PERIOD' },
    { accessMode: 'PERIOD', accessStartsAt: now, accessEndsAt: now },
    { accessMode: 'PERIOD', accessStartsAt: 'invalid', accessEndsAt: now },
    { accessMode: 'DURATION', accessDurationDays: 0 },
    { accessMode: 'DURATION', accessDurationDays: 1.5 },
    { accessMode: 'DURATION', accessDurationDays: 3651 },
  ])('rejects invalid paid periods: %j', offer => {
    expect(() => validateAccessPeriod({ isMonetized: true, ...offer })).toThrow();
  });
  it('accepts both scheduled dates and a duration', () => {
    expect(() => validateAccessPeriod({ isMonetized: true, accessMode: 'PERIOD', accessStartsAt: now, accessEndsAt: new Date(now.getTime() + 1) })).not.toThrow();
    expect(() => validateAccessPeriod({ isMonetized: true, accessMode: 'DURATION', accessDurationDays: 30 })).not.toThrow();
  });
  it.each(['SONG', 'ALBUM', 'VIDEO', 'AUDIOBOOK', 'COURSE'])('denies expired %s purchases and allows renewals', async type => {
    const db: any = { user: { findUnique: jest.fn().mockResolvedValue(null) }, userPurchasedContent: {
      findUnique: jest.fn().mockResolvedValue({ accessEndsAt: new Date(Date.now() - 1) }),
    } };
    const access = new ContentAccessService(db);
    const item = { id: 'content', isPublished: true, isMonetized: true, price: 100 };
    expect(await access.canAccess(type, item, { id: 'buyer' })).toBe(false);
    db.userPurchasedContent.findUnique.mockResolvedValue({ accessStartsAt: new Date(Date.now() - 100), accessEndsAt: new Date(Date.now() + 100000) });
    expect(await access.canAccess(type, item, { id: 'buyer' })).toBe(true);
  });
  it('expires inherited album access and rechecks previously issued streaming tickets', async () => {
    const purchase: any = { accessEndsAt: new Date(Date.now() + 100000) };
    const item = { id: 'song', audioUrl: '/uploads/audio/song.mp3', isMonetized: false, artists: [], albumId: 'album', album: { isMonetized: true } };
    const db: any = { song: { findUnique: jest.fn().mockResolvedValue(item) }, user: { findUnique: jest.fn().mockResolvedValue(null) },
      userPurchasedContent: { findUnique: jest.fn().mockImplementation(({ where }) => where.userId_contentId_contentType.contentType === 'ALBUM' ? purchase : null) } };
    const access = new ContentAccessService(db);
    const result = await access.playback('SONG', 'song', { id: 'buyer' });
    const ticket = access.verifyTicket(new URL(result.url, 'http://local').searchParams.get('ticket')!);
    purchase.accessEndsAt = new Date(Date.now() - 1);
    await expect(access.source(ticket.type, ticket.contentId, { id: ticket.userId })).rejects.toThrow();
  });
});
