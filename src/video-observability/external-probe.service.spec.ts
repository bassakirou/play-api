import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { ExternalProbeService } from './external-probe.service';

describe('Signed external probes', () => {
  const secret = 'probe-secret-'.repeat(4);
  const upsert = jest.fn(async (_args: any) => ({}));
  const service = new ExternalProbeService(
    { videoExternalProbe: { upsert } } as any,
    new ConfigService({ MONITOR_EXTERNAL_PROBE_SECRET: secret }),
  );
  const sign = (body: Buffer) =>
    createHmac('sha256', secret).update(body).digest('hex');
  beforeEach(() => upsert.mockClear());
  it('authenticates exact raw bytes and deduplicates buffered reports by timestamp', async () => {
    const body = Buffer.from(
      JSON.stringify({
        probeId: 'external-africa',
        observedAt: new Date().toISOString(),
        status: 'down',
        latencyMs: null,
      }),
    );
    await expect(service.receive(body, '0'.repeat(64))).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
    await service.receive(body, sign(body));
    expect(upsert.mock.calls[0][0].where.probeId_observedAt.probeId).toBe(
      'external-africa',
    );
    expect(upsert.mock.calls[0][0].update).toEqual({});
  });
  it('rejects malformed, very old and future reports even when signed', async () => {
    for (const value of [
      null,
      {},
      { probeId: 'a', observedAt: '2020-01-01', status: 'up' },
      {
        probeId: 'a',
        observedAt: new Date(Date.now() + 3_600_000).toISOString(),
        status: 'up',
      },
    ]) {
      const body = Buffer.from(JSON.stringify(value));
      await expect(service.receive(body, sign(body))).rejects.toThrow();
    }
    expect(upsert).not.toHaveBeenCalled();
  });
});
