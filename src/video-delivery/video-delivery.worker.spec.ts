import { VideoDeliveryService } from './video-delivery.service';

describe('Persistent delivery worker', () => {
  const uid = 'a'.repeat(32);
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-24T10:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());
  function fixture() {
    let row: any = {
      id: 'job-1',
      mediaAssetId: 'asset-1',
      status: 'QUEUED',
      attempts: 0,
      remoteUid: null,
      leaseUntil: null,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
      mediaAsset: { originalBucket: 'videos', originalObject: 'source.mp4' },
    };
    const same = (a: any, b: any) =>
      a instanceof Date && b instanceof Date ? +a === +b : a === b;
    const db: any = {
      video: { updateMany: async () => ({ count: 0 }) },
      videoDelivery: {
        findFirst: async () =>
          ['QUEUED', 'PROCESSING', 'RETRY'].includes(row.status) &&
          +row.nextAttemptAt <= Date.now() &&
          (!row.leaseUntil || +row.leaseUntil < Date.now())
            ? { ...row }
            : null,
        findUnique: async () => ({ ...row }),
        updateMany: async ({ where, data }: any) => {
          if (
            !Object.entries(where).every(([key, value]) =>
              same(row[key], value),
            )
          )
            return { count: 0 };
          row = { ...row, ...data };
          return { count: 1 };
        },
      },
    };
    const provider: any = {
      isEnabled: () => true,
      findCopy: async () => null,
      sourceUrl: () =>
        'https://api.test.local/video-delivery/source/asset-1?signature=temporary',
      copy: jest.fn(async () => ({
        uid,
        readyToStream: false,
        status: { state: 'queued' },
      })),
      inspect: jest.fn(async () => ({
        uid,
        readyToStream: true,
        status: { state: 'ready', pctComplete: '100' },
      })),
    };
    const minio: any = {
      getBucketName: () => 'videos',
      presignGet: async () =>
        'https://media.test/videos/source.mp4?signature=temporary',
    };
    return {
      db,
      provider,
      row: () => row,
      worker: () => new VideoDeliveryService(db, minio, provider),
    };
  }

  it('claims a job only once across two worker instances and resumes inspection after restart', async () => {
    const f = fixture();
    await Promise.all([f.worker().processNext(), f.worker().processNext()]);
    expect(f.provider.copy).toHaveBeenCalledTimes(1);
    expect(f.row()).toMatchObject({
      status: 'PROCESSING',
      remoteUid: uid,
      leaseUntil: null,
    });
    jest.advanceTimersByTime(31_000);
    await f.worker().processNext();
    expect(f.row().status).toBe('READY');
    expect(f.provider.copy).toHaveBeenCalledTimes(1);
  });

  it('recovers an already accepted copy after a lost response instead of paying for another copy', async () => {
    const f = fixture();
    f.provider.findCopy = async () => ({
      uid,
      readyToStream: true,
      status: { state: 'ready', pctComplete: '100' },
    });
    await f.worker().processNext();
    expect(f.row()).toMatchObject({ status: 'READY', remoteUid: uid });
    expect(f.provider.copy).not.toHaveBeenCalled();
  });

  it('accepts a remotely READY job even if its processing window has expired', async () => {
    const f = fixture();
    f.row().status = 'PROCESSING';
    f.row().remoteUid = uid;
    f.row().createdAt = new Date(Date.now() - 25 * 3600_000);
    await f.worker().processNext();
    expect(f.row().status).toBe('READY');
  });

  it('gives a manually retried timed-out job a new processing window', async () => {
    const f = fixture();
    f.row().status = 'ERROR';
    f.row().remoteUid = uid;
    f.row().createdAt = new Date(Date.now() - 25 * 3600_000);
    f.provider.inspect = async () => ({
      uid,
      readyToStream: false,
      status: { state: 'inprogress' },
    });
    await f.worker().retry('job-1');
    await f.worker().processNext();
    jest.advanceTimersByTime(31_000);
    await f.worker().processNext();
    expect(f.row().status).toBe('PROCESSING');
  });

  it('submits a new rendition after an encoding failure is manually retried', async () => {
    const f = fixture();
    f.row().status = 'PROCESSING';
    f.row().remoteUid = uid;
    f.provider.inspect = async () => ({
      uid,
      readyToStream: false,
      status: { state: 'error' },
    });
    await f.worker().processNext();
    expect(f.row().status).toBe('ERROR');
    await f.worker().retry('job-1');
    await f.worker().processNext();
    expect(f.provider.copy).toHaveBeenCalledTimes(1);
    expect(f.row().status).toBe('PROCESSING');
  });

  it('backs off on external failures and stops after five failed attempts without deleting the original', async () => {
    const f = fixture();
    f.provider.findCopy = async () => {
      throw new Error('provider secret should not be stored');
    };
    for (let i = 0; i < 5; i++) {
      await f.worker().processNext();
      expect(f.row().leaseUntil).toBeNull();
      expect(f.row().lastError).not.toContain('provider secret');
      jest.advanceTimersByTime(3_600_001);
    }
    expect(f.row()).toMatchObject({
      status: 'ERROR',
      attempts: 5,
      mediaAsset: { originalBucket: 'videos', originalObject: 'source.mp4' },
    });
    await f.worker().processNext();
    expect(f.row().attempts).toBe(5);
  });
});
