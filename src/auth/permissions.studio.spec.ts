import { PermissionsGuard } from './permissions.guard';

it('requires an explicit artist role before granting publication permissions', async () => {
  const db: any = { user: { findUnique: jest.fn(async () => ({ systemRoles: ['USER'], role: { name: 'USER', permissions: [] }, artistProfile: { id: 'legacy' } })) } };
  const guard = new PermissionsGuard({ get: () => ['create:song'] } as any, db);
  const context: any = { getHandler: () => ({}), switchToHttp: () => ({ getRequest: () => ({ user: { userId: 'standard', role: 'USER' } }) }) };
  await expect(guard.canActivate(context)).rejects.toThrow('Insufficient permissions');
  db.user.findUnique.mockResolvedValue({ systemRoles: ['USER', 'ARTIST'], role: { name: 'USER', permissions: [] }, artistProfile: { id: 'legacy' } });
  await expect(guard.canActivate(context)).resolves.toBe(true);
});
