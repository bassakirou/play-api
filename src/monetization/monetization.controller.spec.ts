import 'reflect-metadata';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MonetizationController } from './monetization.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FinancialAdminGuard } from './financial-admin.guard';

describe('financial administration', () => {
  it('requires the database-backed administrator guard for every admin route', () => {
    const proto = MonetizationController.prototype;
    const routes = Object.getOwnPropertyNames(proto).filter(name => String(Reflect.getMetadata(PATH_METADATA, proto[name]) || '').startsWith('admin/'));
    expect(routes.length).toBeGreaterThanOrEqual(9);
    for (const name of routes) expect(Reflect.getMetadata(GUARDS_METADATA, proto[name])).toContain(FinancialAdminGuard);
  });
  it('refuses a member despite an admin role in the request', async () => {
    const guard = new FinancialAdminGuard({ isAdmin: async () => false } as any);
    await expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ user: { id: 'member', role: 'SUPER_ADMIN' } }) }) } as any)).rejects.toThrow();
  });
  it('authenticates gift payments so their status belongs to the sender', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, MonetizationController.prototype.sendGift)).toContain(JwtAuthGuard);
  });

});
