import { LegacyMediaGuard } from './legacy-media.guard';

it('never interprets an attacker-hosted path as a private MinIO source', async () => {
  const db: any = { video: { findFirst: jest.fn(async () => ({ id: 'fake-free', isMonetized: false })) } };
  const access: any = { canAccess: jest.fn(async () => true) };
  const guard = new LegacyMediaGuard(db, access);
  const request = { path: '/files/resolved-video', query: { url: 'https://attacker.invalid/videos/paid-original.mp4' } };
  await expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as any)).rejects.toThrow();
  expect(access.canAccess).not.toHaveBeenCalled();
});
