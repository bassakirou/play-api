import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { CloudflareStreamService } from './cloudflare-stream.service';

describe('Cloudflare Stream boundary', () => {
  const config = (values: Record<string, string | undefined> = {}) =>
    new ConfigService(values);
  const values = {
    VIDEO_DELIVERY_PROVIDER: 'cloudflare',
    CLOUDFLARE_ACCOUNT_ID: 'account123',
    CLOUDFLARE_STREAM_API_TOKEN: 'private-token',
    CLOUDFLARE_STREAM_CUSTOMER_CODE: 'customer-test',
    CLOUDFLARE_STREAM_WEBHOOK_SECRET: 'webhook-secret',
    VIDEO_DELIVERY_ORIGIN_URL: 'https://api.test.local',
  };
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('does not make an external request while disabled or incompletely configured', async () => {
    const request = jest.fn();
    global.fetch = request;
    for (const settings of [{}, { VIDEO_DELIVERY_PROVIDER: 'cloudflare' }]) {
      const service = new CloudflareStreamService(config(settings));
      expect(service.isEnabled()).toBe(false);
      await expect(
        service.copy('https://media.test/videos/source.mp4', 'source-1'),
      ).rejects.toThrow();
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('uploads a copy requiring signed playback without exposing the original as public playback', async () => {
    let payload: any;
    global.fetch = jest.fn(async (_url, options: any) => {
      payload = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          success: true,
          result: {
            uid: 'a'.repeat(32),
            readyToStream: false,
            status: { state: 'queued' },
          },
        }),
      } as any;
    });
    const service = new CloudflareStreamService(config(values));
    expect(
      await service.copy(
        'https://media.test/videos/source.mp4?signature=temporary',
        'source-1',
      ),
    ).toMatchObject({ uid: 'a'.repeat(32) });
    expect(payload.requireSignedURLs).toBe(true);
    expect(payload.meta.mediaAssetId).toBe('source-1');
    expect(JSON.stringify(service.configuration())).not.toContain(
      'private-token',
    );
  });

  it('rejects modified, old, future or missing webhook signatures', () => {
    const service = new CloudflareStreamService(config(values));
    const body = Buffer.from('{"uid":"video"}\n');
    const now = Math.floor(Date.now() / 1000);
    const sign = (time: number) =>
      `time=${time},sig1=${createHmac('sha256', 'webhook-secret').update(`${time}.`).update(body).digest('hex')}`;
    expect(service.verifyWebhook(body, sign(now))).toBe(true);
    expect(
      service.verifyWebhook(Buffer.from('{"uid":"other"}'), sign(now)),
    ).toBe(false);
    expect(service.verifyWebhook(body, sign(now - 600))).toBe(false);
    expect(service.verifyWebhook(body, sign(now + 600))).toBe(false);
    expect(service.verifyWebhook(body, undefined)).toBe(false);
  });

  it('does not include provider errors or credentials in the exception', async () => {
    global.fetch = jest.fn(
      async () =>
        ({
          ok: false,
          status: 401,
          json: async () => ({ errors: [{ message: 'private-token' }] }),
        }) as any,
    );
    await expect(
      new CloudflareStreamService(config(values)).copy(
        'https://media.test/source.mp4',
        'source-1',
      ),
    ).rejects.toThrow('Cloudflare Stream : requête refusée (401)');
  });

  it('does not recover an old failed encoding when looking for an accepted copy', async () => {
    global.fetch = jest.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({
            success: true,
            result: [
              {
                uid: 'b'.repeat(32),
                meta: { mediaAssetId: 'source-1' },
                status: { state: 'error' },
              },
            ],
          }),
        }) as any,
    );
    await expect(
      new CloudflareStreamService(config(values)).findCopy('source-1'),
    ).resolves.toBeNull();
  });

  it('signs a temporary origin URL that cannot be reused for another original', () => {
    const service = new CloudflareStreamService(config(values));
    const url = new URL(service.sourceUrl('source-1'));
    const expires = url.searchParams.get('expires')!;
    const signature = url.searchParams.get('signature')!;
    expect(service.verifySource('source-1', expires, signature)).toBe(true);
    expect(service.verifySource('source-2', expires, signature)).toBe(false);
    expect(service.verifySource('source-1', '0', signature)).toBe(false);
  });
});
