import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class StartVideoSessionDto {
  @IsUUID()
  videoId: string;
}

export class VideoPulseDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  token: string;
  @IsInt()
  @Min(1)
  @Max(2147483647)
  sequence: number;
  @IsNumber()
  @Min(0)
  @Max(604800)
  cumulativePlayedSeconds: number;
  @IsNumber()
  @Min(0)
  @Max(604800)
  bufferSeconds: number;
  @IsInt()
  @Min(0)
  @Max(100000)
  stalls: number;
  @IsInt()
  @Min(0)
  @Max(100000)
  errors: number;
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(3600000)
  startupMs?: number;
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(16384)
  height?: number;
  @IsBoolean()
  playing: boolean;
  @IsBoolean()
  ended: boolean;
}
