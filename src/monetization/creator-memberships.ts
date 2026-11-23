import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { CreatorPlan, Prisma, PrismaClient } from '@prisma/client';
import { AcademicSubscriptionService } from '../content-access/academic-subscription.service';
import { PrismaService } from '../prisma/prisma.service';
import { CREATOR_PLAN_TYPES, CreatorPlanDto } from './dto/creator-plan.dto';

type Database = PrismaClient | Prisma.TransactionClient;
const MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 };

export function membershipEnd(start: Date, cadence: string) {
  const months = MONTHS[cadence];
  if (!months) throw new BadRequestException('Périodicité invalide.');
  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}

export function planVersion(plan: CreatorPlan) {
  return createHash('sha256').update(JSON.stringify([plan.id, plan.name, plan.description, plan.price, plan.cadence, plan.contentTypes, plan.active])).digest('hex');
}

export function planScope(type: string) { return type === 'LIVE_REPLAY' ? 'LIVE' : type; }

export async function eligiblePlanTypes(db: PrismaService, creatorId: string) {
  const user = await db.user.findUnique({ where: { id: creatorId }, select: { systemRoles: true, role: { select: { name: true } } } });
  const roles = [...(user?.systemRoles || []), user?.role?.name || ''].map(role => role.toUpperCase());
  const has = (...names: string[]) => names.some(name => roles.includes(name));
  if (has('SUPER_ADMIN', 'ADMIN')) return [...CREATOR_PLAN_TYPES];
  const types: string[] = [];
  if (has('ARTIST', 'ARTISTE')) types.push('SONG', 'ALBUM');
  if (has('CREATOR', 'CREATEUR')) types.push('VIDEO');
  if (has('AUTHOR', 'AUTEUR')) types.push('AUDIOBOOK');
  if (has('ACADEMIC', 'FORMATEUR', 'ENSEIGNANT')) {
    try {
      await new AcademicSubscriptionService(db).assertCanPublish(creatorId);
      types.push('COURSE');
    } catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
  }
  if (types.length || has('ACADEMIC', 'FORMATEUR', 'ENSEIGNANT')) types.push('LIVE');
  return types;
}

export async function saveCreatorPlan(db: PrismaService, creatorId: string, dto: CreatorPlanDto, id?: string) {
  const allowed = await eligiblePlanTypes(db, creatorId);
  if (!dto.contentTypes.every(type => allowed.includes(type)))
    throw new ForbiddenException('Votre profil ne permet pas de proposer tous les types sélectionnés.');
  const name = dto.name.trim();
  const description = dto.description.trim();
  if (!name || !description) throw new BadRequestException('Indiquez un nom et une description pour l’abonnement.');
  const data = { ...dto, name, description };
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${creatorId} FOR UPDATE`;
    if (id) {
      const result = await tx.creatorPlan.updateMany({ where: { id, creatorId }, data });
      if (!result.count) throw new NotFoundException('Abonnement introuvable.');
      return tx.creatorPlan.findUnique({ where: { id } });
    }
    if (await tx.creatorPlan.count({ where: { creatorId } }) >= 3)
      throw new BadRequestException('Vous pouvez enregistrer jusqu’à trois abonnements. Modifiez ou supprimez une offre existante.');
    return tx.creatorPlan.create({ data: { ...data, creatorId } });
  });
}

/** Ownership and publication scope shared by checkout, playback and the member catalog. */
function catalogQueries(db: Database, type: string, creatorId?: string, id?: string) {
  const item = id ? { id } : {};
  const paid = { ...item, isMonetized: true, price: { gt: 0 } };
  const published = { ...paid, isPublished: true };
  const artist = creatorId ? { userId: creatorId } : {};
  switch (type) {
    case 'SONG': return db.song.findMany({ where: { ...paid, artists: { some: artist } }, select: { id: true, artists: { select: { userId: true } } } }).then(rows => rows.map(row => ({ id: row.id, owners: row.artists.map(a => a.userId) })));
    case 'ALBUM': return db.album.findMany({ where: { ...paid, ...(creatorId ? { artist } : {}) }, select: { id: true, artist: { select: { userId: true } } } }).then(rows => rows.map(row => ({ id: row.id, owners: [row.artist?.userId] })));
    case 'VIDEO': return db.video.findMany({ where: { ...published, ...(creatorId ? { OR: [{ userId: creatorId }, { userId: null, artists: { some: artist } }] } : {}) }, select: { id: true, userId: true, artists: { select: { userId: true } } } }).then(rows => rows.map(row => ({ id: row.id, owners: row.userId ? [row.userId] : row.artists.map(a => a.userId) })));
    case 'AUDIOBOOK': return db.audiobook.findMany({ where: { ...paid, authorId: creatorId }, select: { id: true, authorId: true } }).then(rows => rows.map(row => ({ id: row.id, owners: [row.authorId] })));
    case 'COURSE': return db.academicCourse.findMany({ where: { ...published, instructorId: creatorId }, select: { id: true, instructorId: true } }).then(rows => rows.map(row => ({ id: row.id, owners: [row.instructorId] })));
    case 'LIVE':
    case 'LIVE_REPLAY': return db.liveStream.findMany({ where: { ...item, userId: creatorId, isPrivate: false,
      ...(type === 'LIVE' ? { status: { in: ['SCHEDULED', 'LIVE'] }, livePrice: { gt: 0 } } : { status: 'REPLAY', isCleanedUp: false, replayPrice: { gt: 0 }, replaySourceObject: { not: null } }),
    }, select: { id: true, userId: true } }).then(rows => rows.map(row => ({ id: row.id, owners: [row.userId] })));
    default: return Promise.resolve([]);
  }
}

export async function creatorPlansForContent(db: PrismaService, buyerId: string | undefined, type: string, id: string) {
  const catalog = await catalogQueries(db, type, undefined, id);
  const creatorIds = [...new Set(catalog.flatMap(row => row.owners).filter((owner): owner is string => !!owner && owner !== buyerId))];
  if (!creatorIds.length) return [];
  const scope = planScope(type);
  const currentScopes = new Map(await Promise.all(creatorIds.map(async creatorId => [creatorId, await eligiblePlanTypes(db, creatorId)] as const)));
  const allowed = creatorIds.filter(creatorId => currentScopes.get(creatorId)?.includes(scope));
  if (!allowed.length) return [];
  const plans = await db.creatorPlan.findMany({ where: { active: true, creatorId: { in: allowed }, contentTypes: { has: scope } }, orderBy: [{ price: 'asc' }, { id: 'asc' }], include: { creator: { select: { name: true } } } });
  return plans.filter(plan => plan.contentTypes.every(scopeType => currentScopes.get(plan.creatorId)?.includes(scopeType)))
    .map(plan => ({ id: plan.id, creatorId: plan.creatorId, creatorName: plan.creator.name, name: plan.name,
      description: plan.description, price: plan.price, cadence: plan.cadence, contentTypes: plan.contentTypes, offerVersion: planVersion(plan) }));
}

export async function membershipExpiry(db: PrismaService, subscriberId: string | undefined, type: string, id: string) {
  if (!subscriberId || !db.creatorMembership) return null;
  const now = new Date();
  const scope = planScope(type);
  const grants = await db.creatorMembership.findMany({ where: { subscriberId, startsAt: { lte: now }, endsAt: { gt: now }, contentTypes: { has: scope } }, orderBy: { endsAt: 'desc' }, select: { creatorId: true, endsAt: true } });
  if (!grants.length) return null;
  const owners = new Set((await catalogQueries(db, type, undefined, id)).flatMap(row => row.owners));
  return grants.find(grant => owners.has(grant.creatorId))?.endsAt ?? null;
}

export async function memberPasses(db: PrismaService, subscriberId: string) {
  const passes = await db.creatorMembership.findMany({ where: { subscriberId }, orderBy: { endsAt: 'desc' }, include: { creator: { select: { name: true } }, transaction: { select: { amount: true } } } });
  const now = new Date();
  const keys = new Map<string, Date>();
  await Promise.all(passes.filter(pass => pass.startsAt <= now && pass.endsAt > now).map(async pass => {
    const types = pass.contentTypes.flatMap(type => type === 'LIVE' ? ['LIVE', 'LIVE_REPLAY'] : [type]);
    await Promise.all(types.map(async type => {
      for (const item of await catalogQueries(db, type, pass.creatorId)) {
        const key = type + ':' + item.id;
        const existing = keys.get(key);
        if (!existing || existing < pass.endsAt) keys.set(key, pass.endsAt);
      }
    }));
  }));
  return { passes: passes.map(pass => ({ id: pass.id, name: pass.planName, creatorName: pass.creator.name,
    startsAt: pass.startsAt, endsAt: pass.endsAt, price: pass.transaction.amount, contentTypes: pass.contentTypes })),
    access: [...keys].map(([key, endsAt]) => ({ key, endsAt })) };
}
