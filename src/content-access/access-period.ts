import { BadRequestException } from '@nestjs/common';

export function isPurchaseActive(purchase: any, now = new Date()): boolean {
  if (!purchase) return false;
  return (!purchase.accessStartsAt || new Date(purchase.accessStartsAt) <= now) &&
    (!purchase.accessEndsAt || new Date(purchase.accessEndsAt) > now);
}

export function validateAccessPeriod(item: any): void {
  if (item.accessMode !== undefined && !['PERMANENT', 'PERIOD', 'DURATION'].includes(item.accessMode))
    throw new BadRequestException('Mode d’accès invalide.');
  if (!item.isMonetized) return;
  if (item.accessMode === 'DURATION') {
    if (!Number.isInteger(item.accessDurationDays) || item.accessDurationDays < 1 || item.accessDurationDays > 3650)
      throw new BadRequestException('La durée doit être comprise entre 1 et 3 650 jours.');
    return;
  }
  if (item.accessMode !== 'PERIOD') return;
  const start = new Date(item.accessStartsAt).getTime();
  const end = new Date(item.accessEndsAt).getTime();
  if (!item.accessStartsAt || !item.accessEndsAt || !Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new BadRequestException('La période d’accès doit avoir un début et une fin postérieure au début.');
}

export function accessPeriodFields(dto: any) {
  return {
    ...(dto.accessDurationDays !== undefined ? { accessDurationDays: dto.accessDurationDays } : {}),
    ...(dto.accessMode !== undefined ? { accessMode: dto.accessMode } : {}),
    ...(dto.accessStartsAt !== undefined ? { accessStartsAt: dto.accessStartsAt ? new Date(dto.accessStartsAt) : null } : {}),
    ...(dto.accessEndsAt !== undefined ? { accessEndsAt: dto.accessEndsAt ? new Date(dto.accessEndsAt) : null } : {}),
  };
}
