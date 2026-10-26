import { CloudflareUsageService } from './cloudflare-usage.service';

describe('CloudflareUsageService', () => {
  let config: Record<string, string>;
  let snapshot: any;
  let prisma: any;
  let service: CloudflareUsageService;
  const analytics = () => ({
    data: {
      viewer: {
        accounts: [
          {
            totals: [{ sum: { minutesViewed: 2000 } }],
            daily: [
              {
                dimensions: { date: '2026-10-01' },
                sum: { minutesViewed: 2000 },
              },
            ],
            countries: [
              {
                dimensions: { clientCountryName: 'CM' },
                sum: { minutesViewed: 2000 },
              },
            ],
          },
        ],
      },
    },
  });
  const response = (body: any) =>
    ({ ok: true, json: async () => body }) as Response;
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-16T12:00:00Z'));
    config = {
      CLOUDFLARE_ACCOUNT_ID: 'account',
      CLOUDFLARE_STREAM_API_TOKEN: 'secret',
    };
    snapshot = null;
    prisma = {
      cloudflareUsageSnapshot: {
        findUnique: jest.fn(async () => snapshot),
        upsert: jest.fn(async ({ create }: any) => {
          snapshot = create;
          return create;
        }),
      },
    };
    service = new CloudflareUsageService(prisma, {
      get: (key: string) => config[key],
    } as any);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(analytics()))
      .mockResolvedValueOnce(
        response({
          success: true,
          result: { totalStorageMinutes: 12, totalStorageMinutesLimit: 1001 },
        }),
      );
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  it('does not contact Cloudflare without credentials or invent zero usage', async () => {
    delete config.CLOUDFLARE_ACCOUNT_ID;
    await service.sync();
    expect((await service.overview()).state).toBe('unconfigured');
    expect((await service.overview()).deliveryMinutes).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('persists UTC monthly sampled analytics and bills purchased storage in blocks', async () => {
    await service.sync();
    expect(await service.overview()).toMatchObject({
      state: 'ready',
      month: '2026-10',
      deliveryMinutes: 2000,
      deliveryUsd: 2,
      storageUsedMinutes: 12,
      storageCapacityUsd: 10,
      totalUsd: 12,
      projectedDeliveryUsd: 4,
      projectedTotalUsd: 14,
      estimated: true,
      countries: [{ code: 'CM', minutes: 2000 }],
    });
    const request = JSON.parse((fetch as jest.Mock).mock.calls[0][1].body);
    expect(request.variables).toEqual({
      accountTag: 'account',
      start: '2026-10-01',
      end: '2026-11-01',
    });
    await service.sync();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([
    { errors: [{ message: 'secret' }], ...analytics() },
    { data: { viewer: { accounts: [] } } },
    { data: { viewer: { accounts: [{ totals: [] }] } } },
    {
      data: {
        viewer: {
          accounts: [{ ...analytics().data.viewer.accounts[0], totals: [] }],
        },
      },
    },
  ])(
    'rejects invalid or partial analytics without writing a fresh snapshot',
    async (body) => {
      (fetch as jest.Mock).mockReset().mockResolvedValue(response(body));
      await service.sync();
      expect(prisma.cloudflareUsageSnapshot.upsert).not.toHaveBeenCalled();
      expect(await service.overview()).toMatchObject({
        state: 'error',
        deliveryMinutes: null,
      });
      expect(JSON.stringify(await service.overview())).not.toContain('secret');
    },
  );
  it('accepts successful empty datasets from a newly activated account as zero delivered minutes', async () => {
    (fetch as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce(
        response({
          data: {
            viewer: { accounts: [{ totals: [], daily: [], countries: [] }] },
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          success: true,
          result: { totalStorageMinutes: 0, totalStorageMinutesLimit: 1000 },
        }),
      );
    await service.sync();
    expect(await service.overview()).toMatchObject({
      state: 'ready',
      deliveryMinutes: 0,
      deliveryUsd: 0,
      storageCapacityUsd: 5,
      totalUsd: 5,
    });
  });
  it('preserves the last successful snapshot and freshness when a later request fails', async () => {
    await service.sync();
    jest.setSystemTime(new Date('2026-10-16T12:31:00Z'));
    (fetch as jest.Mock).mockRejectedValue(new Error('secret body'));
    await service.sync();
    expect(await service.overview()).toMatchObject({
      state: 'stale',
      fetchedAt: '2026-10-16T12:00:00.000Z',
      deliveryMinutes: 2000,
    });
  });
  it('keeps storage and totals unknown if the storage request fails', async () => {
    (fetch as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce(response(analytics()))
      .mockRejectedValueOnce(new Error('private'));
    await service.sync();
    expect(await service.overview()).toMatchObject({
      deliveryUsd: 2,
      storageCapacityUsd: null,
      totalUsd: null,
      projectedTotalUsd: null,
    });
  });
  it('suppresses projection before 24 hours and does not reuse a previous month', async () => {
    jest.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    await service.sync();
    expect((await service.overview()).projectedDeliveryUsd).toBeNull();
    jest.setSystemTime(new Date('2026-11-01T00:00:00Z'));
    prisma.cloudflareUsageSnapshot.findUnique.mockResolvedValue(null);
    expect((await service.overview()).deliveryMinutes).toBeNull();
  });
  it('uses the dedicated analytics token, custom rates, and a positive budget', async () => {
    config.CLOUDFLARE_STREAM_ANALYTICS_TOKEN = 'analytics-only';
    config.MONITOR_STREAM_DELIVERY_USD_PER_1000 = '2';
    config.MONITOR_STREAM_STORAGE_USD_PER_1000 = '7';
    config.MONITOR_MONTHLY_BUDGET_USD = '50';
    await service.sync();
    expect((fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe(
      'Bearer analytics-only',
    );
    expect((fetch as jest.Mock).mock.calls[1][1].headers.Authorization).toBe(
      'Bearer secret',
    );
    expect(await service.overview()).toMatchObject({
      deliveryUsd: 4,
      storageCapacityUsd: 14,
      budgetUsd: 50,
    });
  });
  it('bounds stalled HTTP calls and releases the next scheduled attempt', async () => {
    (fetch as jest.Mock).mockReset().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(new Error('private timeout')),
          );
        }),
    );
    // Native timeout signals use real timers; intercept only this HTTP boundary signal.
    jest.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), milliseconds);
      return controller.signal;
    });
    const pending = service.sync();
    await jest.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(await service.overview()).toMatchObject({
      state: 'error',
      fetchedAt: null,
    });
    jest.setSystemTime(new Date('2026-10-16T12:16:00Z'));
    (fetch as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce(response(analytics()))
      .mockResolvedValueOnce(
        response({
          success: true,
          result: { totalStorageMinutes: 0, totalStorageMinutesLimit: 0 },
        }),
      );
    await service.sync();
    expect((await service.overview()).state).toBe('ready');
  });
});
