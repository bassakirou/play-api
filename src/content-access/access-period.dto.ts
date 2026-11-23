import { IsIn, IsISO8601, IsOptional, IsInt, Min, Max } from 'class-validator';

export class AccessPeriodDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  accessDurationDays?: number | null;
  @IsOptional()
  @IsIn(['PERMANENT', 'PERIOD', 'DURATION'])
  accessMode?: 'PERMANENT' | 'PERIOD' | 'DURATION';

  @IsOptional()
  @IsISO8601({ strict: true })
  accessStartsAt?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  accessEndsAt?: string | null;
}
