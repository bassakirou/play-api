import { VideoSessionService } from './video-session.service';

describe('Viewer estimates', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-24T10:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());
  function fixture() {
    let row: any;
    const db: any = {
      videoPlaybackSession: {
        create: async ({ data }: any) =>
          (row = {
            id: 'session-1',
            sequence: 0,
            playedSeconds: 0,
            reportedSeconds: 0,
            bufferSeconds: 0,
            stalls: 0,
            errors: 0,
            endedAt: null,
            ...data,
          }),
        findUnique: async () => row,
        updateMany: async ({ where, data }: any) => {
          if (where.sequence !== row.sequence || row.endedAt)
            return { count: 0 };
          row = { ...row, ...data };
          return { count: 1 };
        },
      },
    };
    const access = { accessibleVideo: async () => ({ id: 'video-1' }) };
    const service = new VideoSessionService(db, access as any);
    return { service, row: () => row, access };
  }
  const pulse = (
    token: string,
    sequence: number,
    cumulativePlayedSeconds: number,
    ended = false,
  ) => ({
    token,
    sequence,
    cumulativePlayedSeconds,
    bufferSeconds: 0,
    stalls: 0,
    errors: 0,
    playing: !ended,
    ended,
  });

  it('starts inactive, expires presence after 75s and stops a session immediately on end', async () => {
    const f = fixture();
    const session = await f.service.start('video-1', undefined, 'ip-hash');
    expect(f.row().playing).toBe(false);
    jest.advanceTimersByTime(30_000);
    await f.service.pulse(session.id, pulse(session.token, 1, 30));
    expect(f.row().playing).toBe(true);
    expect(+f.row().expiresAt).toBe(Date.now() + 75_000);
    await f.service.pulse(session.id, pulse(session.token, 2, 30, true));
    expect(f.row().playing).toBe(false);
    expect(+f.row().expiresAt).toBe(Date.now());
  });

  it('rejects another session token and ignores duplicate or out-of-order pulses', async () => {
    const f = fixture();
    const session = await f.service.start('video-1', undefined, 'ip-hash');
    await expect(
      f.service.pulse(session.id, pulse('0'.repeat(64), 1, 0)),
    ).rejects.toThrow();
    jest.advanceTimersByTime(30_000);
    await f.service.pulse(session.id, pulse(session.token, 2, 30));
    await f.service.pulse(session.id, pulse(session.token, 1, 100));
    expect(f.row().playedSeconds).toBe(30);
  });

  it('caps reported time by server elapsed time instead of crediting hours from one heartbeat', async () => {
    const f = fixture();
    const session = await f.service.start('video-1', undefined, 'ip-hash');
    jest.advanceTimersByTime(30_000);
    await f.service.pulse(session.id, pulse(session.token, 1, 3600));
    expect(f.row().playedSeconds).toBeLessThanOrEqual(32);
  });

  it('checks the content access policy before allocating a session', async () => {
    const f = fixture();
    f.access.accessibleVideo = async () => {
      throw new Error('purchase required');
    };
    await expect(
      f.service.start('paid-video', undefined, 'ip-hash'),
    ).rejects.toThrow('purchase required');
    expect(f.row()).toBeUndefined();
  });
});
