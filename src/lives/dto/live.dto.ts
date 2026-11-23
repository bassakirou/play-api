import { AccessPeriodDto } from '../../content-access/access-period.dto';
import { IsString, IsOptional, IsEnum, IsArray, IsNumber, IsInt, IsBoolean, Min, Max, IsNotEmpty } from 'class-validator';

export class LivePricingDto extends AccessPeriodDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  livePrice?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  liveDiscountPrice?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  replayPrice?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  replayDiscountPrice?: number | null;

}

export class CreateLiveDto extends LivePricingDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(['video', 'radio'])
  type?: 'video' | 'radio';

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  streamUrl?: string;

  @IsOptional()
  @IsEnum(['WEBRTC', 'HLS', 'AUDIO_STREAM', 'EXTERNAL'])
  playbackType?: 'WEBRTC' | 'HLS' | 'AUDIO_STREAM' | 'EXTERNAL';

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  coverUrl?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(30)
  retentionDays?: number;

  @IsOptional()
  @IsEnum(['SCHEDULED', 'LIVE', 'ENDED'])
  status?: 'SCHEDULED' | 'LIVE' | 'ENDED';

  @IsOptional()
  scheduledAt?: string | Date;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsBoolean()
  isAcademic?: boolean;

  @IsOptional()
  @IsString()
  aspectRatio?: string;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @IsOptional()
  @IsEnum(['link', 'invite'])
  privateAccessType?: 'link' | 'invite';

  @IsOptional()
  @IsArray()
  invitedEmails?: string[];
}

export class UpdateLiveDto extends LivePricingDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  scheduledAt?: string | Date;

  @IsOptional()
  @IsEnum(['video', 'radio'])
  type?: 'video' | 'radio';

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(['SCHEDULED', 'LIVE', 'ENDED'])
  status?: 'SCHEDULED' | 'LIVE' | 'ENDED';

  @IsOptional()
  @IsString()
  streamUrl?: string;

  @IsOptional()
  @IsEnum(['WEBRTC', 'HLS', 'AUDIO_STREAM', 'EXTERNAL'])
  playbackType?: 'WEBRTC' | 'HLS' | 'AUDIO_STREAM' | 'EXTERNAL';

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  coverUrl?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(30)
  retentionDays?: number;

  @IsOptional()
  @IsString()
  recordingUrl?: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsBoolean()
  isAcademic?: boolean;

  @IsOptional()
  @IsString()
  aspectRatio?: string;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @IsOptional()
  @IsEnum(['link', 'invite'])
  privateAccessType?: 'link' | 'invite';

  @IsOptional()
  @IsArray()
  invitedEmails?: string[];
}

export class AddCommentDto {
  @IsString()
  @IsNotEmpty()
  text: string;

  @IsOptional()
  @IsString()
  userName?: string;

  @IsOptional()
  @IsString()
  userAvatar?: string;

  @IsOptional()
  @IsString()
  role?: string;
}

export class AddReactionDto {
  @IsString()
  @IsNotEmpty()
  emoji: string;
}
