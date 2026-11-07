import { TaraService } from './tara.service';
describe('Tara transport', () => {
  it('accepts the transaction list shape without a status envelope', async () => {
    const service = new TaraService({ monetizationConfig: { findUnique: async () => ({ taraApiKey: 'key', taraBusinessId: 'business' }) } } as any);
    const original = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ price: 100, transactionList: [{ productId: 'p', amount: 100 }] }) });
    try { expect(await service.findTransactionEvidence('p')).toMatchObject({ productId: 'p', amount: 100 }); }
    finally { global.fetch = original; }
  });
  it('does not turn HTTP 200 transaction-not-found into a pending payment', async () => {
    const service = new TaraService({} as any);
    jest.spyOn(service as any, 'taraPost').mockResolvedValue({ status: 'ERROR', message: 'TRANSACTION_NOT_FOUND' });
    await expect(service.getTransactionStatus('missing')).rejects.toThrow('TRANSACTION_NOT_FOUND');
  });
  it('normalizes the actual status envelope and verifies the original amount before provider fees', async () => {
    const service = new TaraService({} as any);
    jest.spyOn(service as any, 'taraPost').mockResolvedValue({ status: 'SUCCESS', transactionId: 'provider-tx',
      payload: JSON.stringify({ productId: 'product', paymentId: 'payment', originalAmount: '100', amount: '97', businessId: 'business', status: 'SUCCESS' }),
      paymentData: JSON.stringify({ productId: 'product', paymentStatus: 'SUCCESS', originalAmount: 100, amount: 97 }) });
    expect(await service.getTransactionStatus('product')).toMatchObject({ productId: 'product', paymentId: 'payment', amount: '100', status: 'SUCCESS', businessId: 'business' });
  });
  it('does not confuse successful status lookup with successful collection', async () => {
    const service = new TaraService({} as any);
    jest.spyOn(service as any, 'taraPost').mockResolvedValue({ status: 'SUCCESS', payload: JSON.stringify({ productId: 'product', status: 'PENDING', originalAmount: '100' }) });
    expect(await service.getTransactionStatus('product')).toMatchObject({ productId: 'product', status: 'PENDING' });
  });
  it('rejects missing credentials without simulating success', async () => {
    const service = new TaraService({ monetizationConfig: { findUnique: async () => ({ taraApiKey: '', taraBusinessId: '', isLiveMode: true }) } } as any);
    await expect(service.getTransactionStatus('p')).rejects.toMatchObject({
      code: 'TARA_NOT_CONFIGURED',
    });
  });
  it('throws on a definite provider refusal', async () => {
    const service = new TaraService({ monetizationConfig: { findUnique: async () => ({ taraApiKey: 'key', taraBusinessId: 'business', taraBaseUrl: 'https://www.dklo.co/api/tara' }) } } as any);
    const original = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'FAILURE' }) });
    try { await expect(service.initiatePayout({ receiverName: 'Author', paymentMethod: 'ORANGE_MONEY', receiverPhoneNumber: '237699999999', receiverId: '237699999999', amount: 100 })).rejects.toThrow(); }
    finally { global.fetch = original; }
  });
  it('returns a final rejected transaction status for reconciliation', async () => {
    const service = new TaraService({ monetizationConfig: { findUnique: async () => ({ taraApiKey: 'key', taraBusinessId: 'business', taraBaseUrl: 'https://www.dklo.co/api/tara' }) } } as any);
    const original = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ productId: 'p', status: 'FAILURE' }) });
    try { expect(await service.getTransactionStatus('p')).toMatchObject({ status: 'FAILURE' }); }
    finally { global.fetch = original; }
  });

  it.each([['development', 'https://local.test/webhook'], ['production', 'https://stored.test/webhook']])('uses a local webhook override only outside production: %s', async (environment, expected) => {
    const oldEnv = process.env.NODE_ENV; const oldOverride = process.env.TARA_LOCAL_WEBHOOK_URL;
    process.env.NODE_ENV = environment; process.env.TARA_LOCAL_WEBHOOK_URL = 'https://local.test/webhook';
    const service = new TaraService({ monetizationConfig: { findUnique: async () => ({ taraWebhookUrl: 'https://stored.test/webhook' }) } } as any);
    const post = jest.spyOn(service as any, 'taraPost').mockResolvedValue({ status: 'SUCCESS' });
    try {
      await service.initiateMobilePay({ productId: 'p', productName: 'Title', productPrice: 100, phoneNumber: '237699999999' });
      expect(post).toHaveBeenCalledWith('/mobilepay', expect.objectContaining({ webHookUrl: expected }));
    } finally {
      if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv;
      if (oldOverride === undefined) delete process.env.TARA_LOCAL_WEBHOOK_URL; else process.env.TARA_LOCAL_WEBHOOK_URL = oldOverride;
    }
  });

});
