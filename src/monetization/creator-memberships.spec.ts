import { creatorPlansForContent, eligiblePlanTypes, membershipEnd, membershipExpiry, saveCreatorPlan } from './creator-memberships';
import { MonetizationService } from './monetization.service';

describe('creator memberships', () => {
  const plan = { id: 'plan', creatorId: 'owner', creator: { name: 'Owner' }, name: 'Pro', description: 'Vidéos', price: 2000, cadence: 'QUARTERLY', contentTypes: ['VIDEO'], active: true };
  const draft = { name: 'Pro', description: 'Vidéos', price: 2000, cadence: 'QUARTERLY' as const, contentTypes: ['VIDEO' as const], active: true };
  let db: any;
  beforeEach(() => {
    db = {
      user: { findUnique: jest.fn().mockResolvedValue({ systemRoles: ['CREATOR'], role: { name: 'USER' } }) },
      userSubscription: { findFirst: jest.fn().mockResolvedValue(null) },
      creatorPlan: { count: jest.fn().mockResolvedValue(0), create: jest.fn(), findMany: jest.fn().mockResolvedValue([plan]) },
      creatorMembership: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      video: { findMany: jest.fn().mockResolvedValue([{ id: 'video', userId: 'owner', artists: [] }]) },
      transaction: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'tx', metadata: {} }), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $queryRaw: jest.fn(), $transaction: jest.fn().mockImplementation(callback => callback(db)),
    };
  });

  it('allows only content types that the creator can publish and requires a valid trainer subscription', async () => {
    db.user.findUnique.mockResolvedValue({ systemRoles: ['AUTHOR', 'ACADEMIC'], role: { name: 'USER' } });
    expect(await eligiblePlanTypes(db, 'owner')).toEqual(['AUDIOBOOK', 'LIVE']);
    db.userSubscription.findFirst.mockResolvedValue({ id: 'academic' });
    expect(await eligiblePlanTypes(db, 'owner')).toEqual(['AUDIOBOOK', 'COURSE', 'LIVE']);
    await expect(saveCreatorPlan(db, 'owner', draft)).rejects.toThrow('profil');
    expect(db.creatorPlan.create).not.toHaveBeenCalled();
  });

  it('enforces the three-plan limit under a creator lock, including inactive plans', async () => {
    db.creatorPlan.count.mockResolvedValue(3);
    await expect(saveCreatorPlan(db, 'owner', draft)).rejects.toThrow('trois abonnements');
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.creatorPlan.create).not.toHaveBeenCalled();
  });

  it('only recognizes time-bounded grants from the creator of the covered content', async () => {
    const end = new Date(Date.now() + 60000);
    db.creatorMembership.findMany.mockResolvedValue([{ creatorId: 'another', endsAt: end }]);
    await expect(membershipExpiry(db, 'buyer', 'VIDEO', 'video')).resolves.toBeNull();
    db.creatorMembership.findMany.mockResolvedValue([{ creatorId: 'owner', endsAt: end }]);
    await expect(membershipExpiry(db, 'buyer', 'VIDEO', 'video')).resolves.toEqual(end);
    expect(db.creatorMembership.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({
      contentTypes: { has: 'VIDEO' }, endsAt: { gt: expect.any(Date) }, startsAt: { lte: expect.any(Date) },
    }) }));
    expect(db.video.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ isPublished: true }) }));
  });

  it('clamps a calendar period to the end of the target month', () => {
    expect(membershipEnd(new Date('2028-01-31T09:00:00Z'), 'MONTHLY').toISOString()).toBe('2028-02-29T09:00:00.000Z');
    expect(membershipEnd(new Date('2028-02-29T09:00:00Z'), 'ANNUAL').toISOString()).toBe('2029-02-28T09:00:00.000Z');
  });

  it('charges the verified plan amount and creates a separate membership on confirmation', async () => {
    const [offer] = await creatorPlansForContent(db, 'buyer', 'VIDEO', 'video');
    const tara: any = { getConfig: jest.fn().mockResolvedValue({ platformFeePercent: 30 }), normalizePhoneNumber: value => value, initiateMobilePay: jest.fn().mockResolvedValue({ status: 'PENDING' }) };
    const service = new MonetizationService(db, tara);
    const request = { contentType: 'VIDEO' as const, contentId: 'video', phoneNumber: '237699999999', creatorPlanId: plan.id, creatorPlanVersion: offer.offerVersion };
    await expect(service.initiatePurchase('buyer', { ...request, creatorPlanVersion: 'stale' }, 'https://local.test')).rejects.toThrow('a changé');
    expect(tara.initiateMobilePay).not.toHaveBeenCalled();
    await service.initiatePurchase('buyer', request, 'https://local.test');
    const { data } = db.transaction.create.mock.calls[0][0];
    expect(data).toMatchObject({ type: 'CREATOR_SUBSCRIPTION', amount: 2000, platformFee: 600, creatorShare: 1400, beneficiaryUserId: 'owner' });
    expect(db.creatorMembership.create).not.toHaveBeenCalled();
    db.transaction.findFirst.mockResolvedValue({ ...data, id: 'tx' });
    await service.completeTransaction(data.productId, 'SUCCESS');
    expect(db.creatorMembership.create).toHaveBeenCalledTimes(1);
    const membership = db.creatorMembership.create.mock.calls[0][0].data;
    expect(membership).toMatchObject({ subscriberId: 'buyer', creatorId: 'owner', planId: plan.id, contentTypes: ['VIDEO'], transactionId: 'tx' });
    expect(membership.endsAt).toEqual(membershipEnd(membership.startsAt, 'QUARTERLY'));
  });
});
