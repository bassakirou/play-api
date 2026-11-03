import { MonetizationService } from './monetization.service';

describe('payment confirmation', () => {
  let db: any; let tara: any; let service: MonetizationService;
  beforeEach(() => {
    db = { transaction: { findFirst: jest.fn().mockResolvedValue({ id: 'tx', productId: 'p', userId: 'buyer', amount: 100, status: 'PENDING' }), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, userPurchasedContent: { upsert: jest.fn() }, $transaction: jest.fn() };
    db.$transaction.mockImplementation((callback: any) => callback(db));
    tara = { getConfig: jest.fn().mockResolvedValue({ taraBusinessId: 'business' }), getTransactionStatus: jest.fn().mockResolvedValue({ productId: 'p', status: 'PENDING', amount: 100 }) };
    service = new MonetizationService(db, tara);
  });
  it('does not trust a forged successful webhook', async () => {
    await service.handleTaraWebhook({ productId: 'p', status: 'SUCCESS', amount: '100' });
    expect(tara.getTransactionStatus).toHaveBeenCalledWith('p');
    expect(db.transaction.update).not.toHaveBeenCalled();
    expect(db.userPurchasedContent.upsert).not.toHaveBeenCalled();
  });
  it('reports a missing provider reference without claiming cancellation, and can recheck old attempts', async () => {
    const tx: any = { id: 'tx', productId: 'p', userId: 'buyer', amount: 100, status: 'PENDING', createdAt: new Date(Date.now() - 3 * 86400000), metadata: { reconcileAttempts: 12 } };
    db.transaction.findFirst.mockImplementation(async () => ({ ...tx }));
    db.$queryRaw = jest.fn().mockResolvedValue([{ id: 'tx' }]);
    db.transaction.update.mockImplementation(async ({ data }: any) => Object.assign(tx, data));
    tara.getTransactionStatus.mockRejectedValue(new Error('TRANSACTION_NOT_FOUND'));
    const result = await service.getTransactionStatus('tx', 'buyer');
    expect(tara.getTransactionStatus).toHaveBeenCalledWith('p');
    expect(result).toMatchObject({ status: 'PENDING', verificationError: 'TRANSACTION_NOT_FOUND' });
    expect(tx.metadata.reconcileAttempts).toBe(13);
    expect(db.userPurchasedContent.upsert).not.toHaveBeenCalled();
  });
  it('rejects an authenticated amount mismatch', async () => {
    tara.getTransactionStatus.mockResolvedValue({ productId: 'p', status: 'SUCCESS', amount: 1 });
    await expect(service.handleTaraWebhook({ productId: 'p', status: 'SUCCESS' })).rejects.toThrow();
    expect(db.userPurchasedContent.upsert).not.toHaveBeenCalled();
  });
  it('keeps pending notifications pending', async () => {
    await service.completeTransaction('p', 'PENDING');
    expect(db.transaction.update).not.toHaveBeenCalled();
    expect(db.transaction.updateMany).not.toHaveBeenCalled();
  });
  it('does not disclose transaction status to another user', async () => {
    await expect((service.getTransactionStatus as any)('tx', 'other')).rejects.toThrow();
  });
  it('redacts configuration secrets on admin reads', async () => {
    tara.getConfig.mockResolvedValue({ taraApiKey: 'secret', taraWebhookSecret: 'secret', taraBusinessId: 'business' });
    expect(await (service as any).getAdminConfig()).not.toHaveProperty('taraApiKey');
  });
  it('grants a verified purchase once even after repeated notification', async () => {
    const tx: any = { id: 'tx', productId: 'p', userId: 'buyer', contentId: 'song', contentType: 'SONG', type: 'CONTENT_PURCHASE', amount: 100, status: 'PENDING' };
    db.transaction.findFirst.mockImplementation(async () => ({ ...tx }));
    db.transaction.updateMany.mockImplementation(async ({ where, data }: any) => {
      if (tx.status !== where.status) return { count: 0 };
      Object.assign(tx, data); return { count: 1 };
    });
    tara.getTransactionStatus.mockResolvedValue({ productId: 'p', status: 'SUCCESS', amount: '100', paymentId: 'payment' });
    await service.handleTaraWebhook({ productId: 'p', status: 'SUCCESS' });
    await service.handleTaraWebhook({ productId: 'p', status: 'SUCCESS' });
    expect(tx.status).toBe('SUCCESS');
    expect(db.userPurchasedContent.upsert).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
  it('rejects successful status without authenticated amount evidence', async () => {
    tara.getTransactionStatus.mockResolvedValue({ productId: 'p', status: 'SUCCESS' });
    tara.findTransactionEvidence = jest.fn().mockResolvedValue(undefined);
    await expect(service.handleTaraWebhook({ productId: 'p', amount: '100', status: 'SUCCESS' })).rejects.toThrow();
    expect(db.userPurchasedContent.upsert).not.toHaveBeenCalled();
  });
  it('reuses an initiated request without submitting a second payment', async () => {
    db.transaction.findFirst.mockResolvedValue({ id: 'tx', productId: 'p', userId: 'buyer', contentId: 'song', contentType: 'SONG', status: 'PENDING', amount: 100 });
    tara.initiateMobilePay = jest.fn();
    const result = await service.initiatePurchase('buyer', { contentId: 'song', contentType: 'SONG', phoneNumber: '237699999999', requestId: 'b155d165-3463-4801-bd3c-96c460668803' }, 'https://local.test');
    expect(result).toMatchObject({ transactionId: 'tx', status: 'PENDING', reused: true });
    expect(tara.initiateMobilePay).not.toHaveBeenCalled();
  });
  it('will not correlate an unknown payment solely by phone', async () => {
    db.transaction.findFirst.mockResolvedValue(null);
    await service.handleTaraWebhook({ paymentId: 'unknown', phoneNumber: '699999999', status: 'SUCCESS' });
    expect(tara.getTransactionStatus).not.toHaveBeenCalled();
  });
  it('locks the payout transition before sending and refuses a second send', async () => {
    const request = { id: 'w', status: 'PENDING', paymentMethod: 'ORANGE_MONEY', phoneNumber: '237699999999', netAmount: 100, user: { name: 'Author' }, artist: null };
    db.withdrawalRequest = { findUnique: jest.fn().mockResolvedValue(request), updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }), update: jest.fn().mockImplementation(async ({ data }) => ({ ...request, ...data })) };
    tara.initiatePayout = jest.fn().mockResolvedValue({ status: 'SUCCESS', payoutId: 'po' });
    const result = await service.reviewWithdrawal('w', 'admin', { action: 'PAY_NOW' });
    expect(result?.status).toBe('PROCESSING');
    expect(result?.payoutId).toBe('po');
    await expect(service.reviewWithdrawal('w', 'admin', { action: 'PAY_NOW' })).rejects.toThrow();
    expect(tara.initiatePayout).toHaveBeenCalledTimes(1);
  });
  it('keeps an uncertain payout reserved without inventing a provider id', async () => {
    db.withdrawalRequest = { findUnique: jest.fn().mockResolvedValue({ id: 'w', user: { name: 'Author' } }), updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockImplementation(async ({ data }) => data) };
    tara.initiatePayout = jest.fn().mockRejectedValue(new Error('timeout'));
    expect(await service.reviewWithdrawal('w', 'admin', { action: 'PAY_NOW' })).toEqual({ status: 'INDETERMINATE' });
  });

  it.each([
    ['VIDEO', { id: 'content', title: 'Video', price: 100, isMonetized: true, artists: [], userId: 'creator' }, 'video'],
    ['AUDIOBOOK', { id: 'content', title: 'Book', price: 100, isMonetized: true, authorUser: { id: 'creator', artistProfile: null } }, 'audiobook'],
  ])('attributes %s revenue to the creator account without requiring an artist', async (contentType, content, model) => {
    db[model as string] = { findUnique: jest.fn().mockResolvedValue(content) };
    db.userPurchasedContent.findUnique = jest.fn().mockResolvedValue(null);
    db.transaction.create = jest.fn().mockResolvedValue({ id: 'tx' });
    tara.getConfig.mockResolvedValue({ platformFeePercent: 30 });
    tara.normalizePhoneNumber = (phone: string) => phone;
    tara.initiateMobilePay = jest.fn().mockResolvedValue({ status: 'SUCCESS' });
    const result = await service.initiatePurchase('buyer', { contentType: contentType as any, contentId: 'content', phoneNumber: '237699999999' }, 'https://local.test');
    expect(db.transaction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ beneficiaryUserId: 'creator', creatorShare: 70 }) }));
    expect(result.status).toBe('PENDING');
    expect(db.userPurchasedContent.upsert).not.toHaveBeenCalled();
  });
  it('reserves withdrawals while holding the creator account lock', async () => {
    db.$queryRaw = jest.fn().mockResolvedValue([{ id: 'creator' }]);
    db.user = { findUnique: jest.fn().mockResolvedValue({ id: 'creator', artistProfile: null }) };
    db.transaction.findMany = jest.fn().mockResolvedValue([{ creatorShare: 10000 }]);
    db.withdrawalRequest = { findMany: jest.fn().mockResolvedValue([{ amountRequested: 7000 }]), create: jest.fn() };
    tara.normalizePhoneNumber = (phone: string) => phone;
    tara.getConfig.mockResolvedValue({ minWithdrawalAmount: 1000 });
    await expect(service.requestWithdrawal('creator', { amountRequested: 4000, paymentMethod: 'ORANGE_MONEY', phoneNumber: '237699999999' })).rejects.toThrow();
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.withdrawalRequest.create).not.toHaveBeenCalled();
  });

  it('reuses an academic subscription request without a second collection', async () => {
    db.transaction.findFirst.mockResolvedValue({ id: 'sub', productId: 'p', userId: 'buyer', type: 'ACADEMIC_SUBSCRIPTION', status: 'PENDING', amount: 5000 });
    tara.initiateMobilePay = jest.fn();
    const result = await service.subscribeAcademic('buyer', { phoneNumber: '237699999999', requestId: 'b155d165-3463-4801-bd3c-96c460668803' } as any, 'https://local.test');
    expect(result).toMatchObject({ transactionId: 'sub', status: 'PENDING', reused: true });
    expect(tara.initiateMobilePay).not.toHaveBeenCalled();
  });

  it('reuses gift requests without sending another collection', async () => {
    db.transaction.findFirst.mockResolvedValue({ id: 'gift-tx', productId: 'g', userId: 'buyer', type: 'GIFT', status: 'PENDING', amount: 100, metadata: { giftCatalogId: 'gift', recipientArtistId: 'artist' } });
    tara.initiateMobilePay = jest.fn();
    const result = await service.sendGift('buyer', { giftCatalogId: 'gift', recipientArtistId: 'artist', phoneNumber: '237699999999', requestId: 'b155d165-3463-4801-bd3c-96c460668803' } as any, 'https://local.test');
    expect(result).toMatchObject({ transactionId: 'gift-tx', status: 'PENDING', reused: true });
    expect(tara.initiateMobilePay).not.toHaveBeenCalled();
  });

});
