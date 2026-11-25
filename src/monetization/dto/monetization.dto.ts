import { IsString, IsNotEmpty, IsNumber, IsOptional, IsBoolean, IsIn, IsInt, Min, Matches, IsUUID, ValidateIf, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { giftImageReference } from '../gift-catalog-artwork';

const trimText = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class UpdateMonetizationConfigDto {
  @IsString()
  @IsOptional()
  taraApiKey?: string;

  @IsString()
  @IsOptional()
  taraBusinessId?: string;

  @IsString()
  @IsOptional()
  taraWebhookSecret?: string;

  @IsString()
  @IsOptional()
  taraBaseUrl?: string;

  @IsString()
  @IsOptional()
  taraReturnUrl?: string;

  @IsString()
  @IsOptional()
  taraWebhookUrl?: string;

  @IsBoolean()
  @IsOptional()
  isLiveMode?: boolean;

  @IsNumber()
  @IsOptional()
  platformFeePercent?: number;

  @IsNumber()
  @IsOptional()
  creatorSharePercent?: number;

  @IsNumber()
  @IsOptional()
  minWithdrawalAmount?: number;

  @IsNumber()
  @IsOptional()
  operatorOmFeePercent?: number;

  @IsNumber()
  @IsOptional()
  operatorMomoFeePercent?: number;
}

export class CreateGiftCatalogDto {
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  name: string; // ex:  LION, TORTUE, CAURIS

  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  label: string; // ex: Le Lion Royal

  @IsInt()
  @Min(1)
  @Max(2147483647)
  amount: number; // en XAF

  @Transform(trimText)
  @IsString()
  @Matches(giftImageReference, { message: 'Une image de cadeau valide est obligatoire.' })
  iconUrl: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @IsOptional()
  order?: number;
}

export class UpdateGiftCatalogDto {
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  @ValidateIf((_, value) => value !== undefined)
  label?: string;

  @IsInt()
  @Min(1)
  @Max(2147483647)
  @ValidateIf((_, value) => value !== undefined)
  amount?: number;

  @Transform(trimText)
  @IsString()
  @Matches(giftImageReference, { message: 'Une image de cadeau valide est obligatoire.' })
  @ValidateIf((_, value) => value !== undefined)
  iconUrl?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @IsOptional()
  order?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class InitiatePurchaseDto {
  @IsOptional()
  @IsUUID()
  creatorPlanId?: string;

  @IsOptional()
  @IsString()
  creatorPlanVersion?: string;

  @IsOptional()
  @IsString()
  offerVersion?: string;

  @IsString()
  @IsNotEmpty()
  contentId: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['SONG', 'ALBUM', 'VIDEO', 'AUDIOBOOK', 'COURSE', 'LIVE', 'LIVE_REPLAY'])
  contentType: 'SONG' | 'ALBUM' | 'VIDEO' | 'AUDIOBOOK' | 'COURSE' | 'LIVE' | 'LIVE_REPLAY';

  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:\+?237|00237)?[62]\d{8}$/)
  phoneNumber: string; // 2376xxxxxxxx
}

export class SendGiftDto {
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsString()
  @IsNotEmpty()
  giftCatalogId: string;

  @IsString()
  @IsNotEmpty()
  recipientArtistId: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:\+?237|00237)?[62]\d{8}$/)
  phoneNumber: string; // 2376xxxxxxxx

  @IsString()
  @IsOptional()
  message?: string;
}

export class SubscribeAcademicDto {
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:\+?237|00237)?[62]\d{8}$/)
  phoneNumber: string; // 2376xxxxxxxx
}

export class CreateWithdrawalRequestDto {
  @IsNumber()
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  amountRequested: number;

  @IsString()
  @IsNotEmpty()
  @IsIn(['MTN_MOBILE_MONEY', 'ORANGE_MONEY'])
  paymentMethod: 'MTN_MOBILE_MONEY' | 'ORANGE_MONEY';

  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:\+?237|00237)?[62]\d{8}$/)
  phoneNumber: string; // 2376xxxxxxxx
}

export class ReviewWithdrawalDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['APPROVE', 'REJECT', 'PAY_NOW'])
  action: 'APPROVE' | 'REJECT' | 'PAY_NOW';

  @IsString()
  @IsOptional()
  rejectionReason?: string;
}
