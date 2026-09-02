import { IsString, IsOptional, IsEnum, IsArray, IsNumber, IsBoolean, Min, Max, IsNotEmpty } from 'class-validator';

export class CreateLiveDto {
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
}

export class UpdateLiveDto {
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
