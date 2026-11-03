import { IsString, IsNotEmpty, IsNumber, IsOptional, IsBoolean, IsIn, IsInt, Min, Matches, IsUUID } from 'class-validator';

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
  @IsIn(['SONG', 'ALBUM', 'VIDEO', 'AUDIOBOOK', 'COURSE'])
  contentType: 'SONG' | 'ALBUM' | 'VIDEO' | 'AUDIOBOOK' | 'COURSE';

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
