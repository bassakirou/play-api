import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateMaintenanceStateDto {
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsBoolean()
  @IsOptional()
  adminPriority?: boolean;
}
