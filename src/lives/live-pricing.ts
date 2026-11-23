import { BadRequestException } from '@nestjs/common';
import { validateAccessPeriod } from '../content-access/access-period';
import type { LivePricingDto } from './dto/live.dto';

type LivePricing = Pick<LivePricingDto, 'livePrice' | 'liveDiscountPrice' | 'replayPrice' | 'replayDiscountPrice' | 'accessDurationDays'> & {
  accessMode?: string;
  accessStartsAt?: string | Date | null;
  accessEndsAt?: string | Date | null;
  isPrivate?: boolean;
  streamUrl?: string | null;
  retentionDays?: number;
};

export function validateLivePricing(live: LivePricing) {
  for (const [price, promotion, label] of [
    [live.livePrice ?? 0, live.liveDiscountPrice, 'du direct'],
    [live.replayPrice ?? 0, live.replayDiscountPrice, 'du replay'],
  ] as const) {
    if (!Number.isSafeInteger(price) || price < 0 || price > 2147483647)
      throw new BadRequestException(`Le prix ${label} doit être un montant entier valide en XAF.`);
    if (promotion != null && (!Number.isSafeInteger(promotion) || promotion <= 0 || promotion >= price))
      throw new BadRequestException(`Le prix promotionnel ${label} doit être positif et inférieur au prix normal.`);
  }
  if ((live.livePrice || live.replayPrice) && (live.isPrivate || live.streamUrl))
    throw new BadRequestException('La vente est disponible pour les directs publics diffusés depuis PyramidPlay. Désactivez le mode privé ou retirez le lien externe.');
  if (live.replayPrice && !live.retentionDays)
    throw new BadRequestException('Activez l’enregistrement pour vendre le replay.');
  validateAccessPeriod({ ...live, isMonetized: Boolean(live.replayPrice) });
}
