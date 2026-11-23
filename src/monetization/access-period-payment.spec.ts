import { MonetizationService } from './monetization.service';

describe('period purchase lifecycle', () => {
  let db: any; let tara: any; let service: MonetizationService;
  const request: any = { contentType: 'VIDEO', contentId: 'v', phoneNumber: '237699999999' };
  beforeEach(() => {
    db = {
      video: { findUnique: jest.fn().mockResolvedValue({ id: 'v', title: 'Video', isPublished: true, isMonetized: true, price: 1000, userId: 'owner', artists: [], accessMode: 'DURATION', accessDurationDays: 30 }) },
      transaction: { create: jest.fn().mockResolvedValue({ id: 'tx', metadata: {} }), update: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      userPurchasedContent: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(),
    };
    db.$transaction.mockImplementation(callback => callback(db));
    tara = { getConfig: jest.fn().mockResolvedValue({ platformFeePercent: 30 }), normalizePhoneNumber: phone => phone,
      initiateMobilePay: jest.fn().mockResolvedValue({ status: 'PENDING' }) };
    service = new MonetizationService(db, tara);
  });
  it('rejects changed checkout conditions before initiating payment', async () => {
    const quote = await service.getPurchaseOffer('VIDEO', 'v');
    db.video.findUnique.mockResolvedValue({ id: 'v', title: 'Video', isPublished: true, isMonetized: true, price: 1000, userId: 'owner', artists: [], accessMode: 'DURATION', accessDurationDays: 7 });
    await expect(service.initiatePurchase('buyer', { ...request, offerVersion: quote.offerVersion }, 'https://local.test')).rejects.toThrow('changé');
    expect(tara.initiateMobilePay).not.toHaveBeenCalled();
  });

  it.each(['LIVE', 'LIVE_REPLAY'] as const)('uses the %s promotional price, platform fee and host account', async contentType => {
    const replay = contentType === 'LIVE_REPLAY';
    db.liveStream = { findUnique: jest.fn().mockResolvedValue({ id: 'v', title: 'Live', userId: 'host',
      status: replay ? 'REPLAY' : 'SCHEDULED', replaySourceObject: replay ? 'recording.webm' : null,
      livePrice: 1000, liveDiscountPrice: 800, replayPrice: 2000, replayDiscountPrice: 1500,
      accessMode: 'DURATION', accessDurationDays: 30 }) };
    await service.initiatePurchase('buyer', { ...request, contentType }, 'https://local.test');
    expect(db.transaction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      contentType, beneficiaryUserId: 'host', amount: replay ? 1500 : 800,
      platformFee: replay ? 450 : 240, creatorShare: replay ? 1050 : 560,
      metadata: expect.objectContaining({ accessDurationDays: replay ? 30 : null }),
    }) }));
  });

  it('does not initiate a live ticket after the broadcast or a replay before recording', async () => {
    db.liveStream = { findUnique: jest.fn().mockResolvedValue({ id: 'v', userId: 'host', status: 'ENDED', livePrice: 1000, replayPrice: 1200 }) };
    await expect(service.initiatePurchase('buyer', { ...request, contentType: 'LIVE' }, 'https://local.test')).rejects.toThrow('closes');
    await expect(service.initiatePurchase('buyer', { ...request, contentType: 'LIVE_REPLAY' }, 'https://local.test')).rejects.toThrow('pas disponible');
    expect(tara.initiateMobilePay).not.toHaveBeenCalled();
  });
  it('snapshots duration at checkout, allowing an expired purchase to renew', async () => {
    db.userPurchasedContent.findUnique.mockResolvedValue({ accessEndsAt: new Date(Date.now() - 1) });
    await service.initiatePurchase('buyer', request, 'https://local.test');
    expect(db.transaction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      metadata: expect.objectContaining({ accessDurationDays: 30, accessStartsAt: null, accessEndsAt: null }),
    }) }));
    expect(tara.initiateMobilePay).toHaveBeenCalledTimes(1);
  });
  it.each([{ id: 'legacy' }, { accessStartsAt: new Date(Date.now() + 1000), accessEndsAt: new Date(Date.now() + 100000) }])('prevents charging an owned permanent or scheduled period', async purchase => {
    db.userPurchasedContent.findUnique.mockResolvedValue(purchase);
    await expect(service.initiatePurchase('buyer', request, 'https://local.test')).rejects.toThrow();
    expect(tara.initiateMobilePay).not.toHaveBeenCalled();
  });
  it('refuses an ended fixed offer before contacting the provider', async () => {
    db.video.findUnique.mockResolvedValue({ isMonetized: true, price: 1000, userId: 'owner', artists: [], accessMode: 'PERIOD', accessStartsAt: new Date(Date.now() - 2000), accessEndsAt: new Date(Date.now() - 1000) });
    await expect(service.initiatePurchase('buyer', request, 'https://local.test')).rejects.toThrow('terminée');
    expect(tara.initiateMobilePay).not.toHaveBeenCalled();
  });
  it('grants the purchased duration from confirmation, replacing the expired right', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-12-01T10:00:00Z'));
    try {
      db.transaction.findFirst.mockResolvedValue({ id: 'tx', status: 'PENDING', type: 'CONTENT_PURCHASE', userId: 'buyer', contentId: 'v', contentType: 'VIDEO', amount: 1000, metadata: { accessDurationDays: 30 } });
      db.userPurchasedContent.findUnique.mockResolvedValue({ accessEndsAt: new Date('2026-11-01') });
      await service.completeTransaction('product', 'SUCCESS', 'payment');
      expect(db.userPurchasedContent.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({
        accessStartsAt: new Date('2026-12-01T10:00:00Z'), accessEndsAt: new Date('2026-12-31T10:00:00Z'),
      }) }));
    } finally { jest.useRealTimers(); }
  });
  it.each([{ accessEndsAt: null }, { accessEndsAt: new Date('2028-01-01') }])('does not shorten an existing grant on a late notification', async previous => {
    db.transaction.findFirst.mockResolvedValue({ id: 'tx', status: 'PENDING', type: 'CONTENT_PURCHASE', userId: 'buyer', contentId: 'v', contentType: 'VIDEO', amount: 1000,
      metadata: { accessStartsAt: '2026-01-01T00:00:00Z', accessEndsAt: '2026-02-01T00:00:00Z' } });
    db.userPurchasedContent.findUnique.mockResolvedValue(previous);
    await service.completeTransaction('product', 'SUCCESS');
    expect(db.userPurchasedContent.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
  });
});
