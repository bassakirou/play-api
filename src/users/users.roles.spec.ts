import { UsersService } from './users.service';
import { UsersController } from './users.controller';

describe('administrative role boundaries', () => {
  let db: any; let service: UsersService;
  beforeEach(() => {
    const user = { id: 'member', email: 'member@test.invalid', name: 'Member', systemRoles: ['USER'], role: { name: 'USER' }, artistProfile: null };
    db = { user: { findUnique: jest.fn().mockResolvedValue(user), create: jest.fn().mockImplementation(async ({ data }) => data), update: jest.fn().mockResolvedValue(user) }, role: { findUnique: jest.fn().mockImplementation(async ({ where }) => ({ id: where.name, name: where.name })) }, artist: { upsert: jest.fn() } };
    service = new UsersService(db);
  });
  it.each(['findOne', 'findByEmail'])('does not promote a standard account merely because it has an artist profile: %s', async (method) => {
    db.user.findUnique.mockResolvedValue({ id: 'member', systemRoles: ['USER'], role: { name: 'USER' }, artistProfile: { id: 'legacy-profile' } });
    const user = await service[method]('member');
    expect(user?.systemRoles).toEqual(['USER']);
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it('does not let public registration create an administrator', async () => {
    await service.create({ email: 'new@test.invalid', name: 'New', password: 'password', role: 'ADMIN', systemRoles: ['ADMIN', 'SUPER_ADMIN'] });
    expect(db.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ roleId: 'USER', systemRoles: ['USER'] }) }));
  });
  it('does not let a member select ADMIN through system roles', async () => {
    await service.updateSystemRoles('member', ['USER', 'ADMIN', 'SUPER_ADMIN']);
    expect(db.user.update.mock.calls.every((call: any) => !(call[0].data.systemRoles || []).some((role: string) => ['ADMIN', 'SUPER_ADMIN'].includes(role)))).toBe(true);
  });
  it('preserves existing administrative grants during self-service role edits', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'member', systemRoles: ['USER', 'ADMIN', 'SUPER_ADMIN'], role: { name: 'USER' }, artistProfile: null });
    await service.updateSystemRoles('member', ['AUTHOR']);
    expect(db.user.update.mock.calls[0][0].data.systemRoles).toEqual(expect.arrayContaining(['ADMIN', 'SUPER_ADMIN']));
  });
  it('blocks direct primary role and system role escalation in ordinary updates', async () => {
    await service.update('member', { role: 'ADMIN', roleId: 'admin', systemRoles: ['ADMIN'], isEmailVerified: true } as any);
    const data = db.user.update.mock.calls[0][0].data;
    expect(data.roleId).toBeUndefined();
    expect(data.systemRoles).not.toContain('ADMIN');
  });
  it('allows only profile fields through the self-service profile route', async () => {
    const update = jest.fn();
    const controller = new UsersController({ update } as any);
    controller.updateProfile({ user: { userId: 'member' } }, { name: 'Safe', role: 'ADMIN', roleId: 'admin', systemRoles: ['ADMIN'], resetToken: 'token', isEmailVerified: true });
    expect(update).toHaveBeenCalledWith('member', { name: 'Safe' });
  });
  it('rejects Prisma mutation objects in ordinary system role updates', async () => {
    await expect(service.update('member', { systemRoles: { push: 'ADMIN' } } as any)).rejects.toThrow();
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it('serializes first-admin bootstrap and rejects an existing installation', async () => {
    db.$transaction = jest.fn().mockImplementation(callback => callback(db));
    db.$queryRaw = jest.fn().mockResolvedValue([]);
    db.user.count = jest.fn().mockResolvedValue(1);
    await expect(service.createFirstAdmin({ email: 'admin@test.invalid', name: 'Admin', password: 'password' })).rejects.toThrow();
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });

});
