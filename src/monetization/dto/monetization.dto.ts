import { IsString, IsNotEmpty, IsNumber, IsOptional, IsBoolean } from 'class-validator';

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
  @IsString()
  @IsNotEmpty()
  name: string; // ex:  LION, TORTUE, CAURIS

  @IsString()
  @IsNotEmpty()
  label: string; // ex: Le Lion Royal

  @IsNumber()
  @IsNotEmpty()
  amount: number; // en XAF

  @IsString()
  @IsNotEmpty()
  iconUrl: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @IsOptional()
  order?: number;
}

export class UpdateGiftCatalogDto {
  @IsString()
  @IsOptional()
  label?: string;

  @IsNumber()
  @IsOptional()
  amount?: number;

  @IsString()
  @IsOptional()
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
  @IsString()
  @IsNotEmpty()
  contentId: string;

  @IsString()
  @IsNotEmpty()
  contentType: 'SONG' | 'ALBUM' | 'VIDEO' | 'AUDIOBOOK';

  @IsString()
  @IsNotEmpty()
  phoneNumber: string; // 2376xxxxxxxx
}

export class SendGiftDto {
  @IsString()
  @IsNotEmpty()
  giftCatalogId: string;

  @IsString()
  @IsNotEmpty()
  recipientArtistId: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber: string; // 2376xxxxxxxx

  @IsString()
  @IsOptional()
  message?: string;
}

export class SubscribeAcademicDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber: string; // 2376xxxxxxxx
}

export class CreateWithdrawalRequestDto {
  @IsNumber()
  @IsNotEmpty()
  amountRequested: number;

  @IsString()
  @IsNotEmpty()
  paymentMethod: 'MTN_MOBILE_MONEY' | 'ORANGE_MONEY';

  @IsString()
  @IsNotEmpty()
  phoneNumber: string; // 2376xxxxxxxx
}

export class ReviewWithdrawalDto {
  @IsString()
  @IsNotEmpty()
  action: 'APPROVE' | 'REJECT' | 'PAY_NOW';

  @IsString()
  @IsOptional()
  rejectionReason?: string;
}
