import { ConfigService } from '@nestjs/config';
import { VideoMonitorService } from './video-monitor.service';

describe('Persistent video monitoring', () => {
  function fixture(settings = {}) {
    let row: any = null;
    const deleteMany = jest.fn((_args: any) => Promise.resolve({ count: 0 }));
    const prisma: any = {
      videoMonitorAlert: {
        findUnique: async () => row,
        upsert: async ({ create, update }: any) =>
          (row = row
            ? { ...row, ...update }
            : {
                id: 'alert',
                resolvedAt: null,
                acknowledgedAt: null,
                ...create,
              }),
        update: async ({ data }: any) => (row = { ...row, ...data }),
        updateMany: async () => ({ count: 0 }),
        deleteMany,
      },
      videoMonitorSample: { deleteMany },
      videoPlaybackSession: { deleteMany },
      videoExternalProbe: { deleteMany },
      $transaction: async (operations: any[]) => Promise.all(operations),
    };
    const host: any = { collect: jest.fn() };
    return {
      service: new VideoMonitorService(
        prisma,
        new ConfigService(settings),
        host,
        {} as any,
        {} as any,
      ),
      row: () => row,
      deleteMany,
      host,
    };
  }

  it('deduplicates ongoing alerts, preserves acknowledgement and reopens a recovered incident', async () => {
    const f = fixture();
    await f.service.setAlert('disk', true, 'warning', 'disk');
    const first = f.row().openedAt;
    f.row().acknowledgedAt = new Date();
    await f.service.setAlert('disk', true, 'critical', 'disk');
    expect(f.row().openedAt).toEqual(first);
    expect(f.row().acknowledgedAt).not.toBeNull();
    await f.service.setAlert('disk', null, 'critical', 'unknown');
    expect(f.row().resolvedAt).toBeNull();
    await f.service.setAlert('disk', false, 'warning', 'disk');
    expect(f.row().resolvedAt).toBeInstanceOf(Date);
    await f.service.setAlert('disk', true, 'warning', 'disk');
    expect(f.row().resolvedAt).toBeNull();
    expect(f.row().acknowledgedAt).toBeNull();
  });

  it('retains cleanup when server collection is disabled', async () => {
    const f = fixture({ MONITORING_ENABLED: 'false' });
    await f.service.sample();
    expect(f.host.collect).not.toHaveBeenCalled();
    await f.service.cleanup();
    expect(f.deleteMany).toHaveBeenCalledTimes(4);
    const cutoff = f.deleteMany.mock.calls[0][0].where.sampledAt.lt;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThan(6.9 * 86_400_000);
  });

  it('refuses acknowledgement for absent or resolved incidents', async () => {
    await expect(fixture().service.acknowledge('absent')).rejects.toThrow(
      'Alerte active introuvable',
    );
  });
});
