import { IsBoolean } from 'class-validator';

export class UpdateMaintenanceStateDto {
  @IsBoolean()
  enabled!: boolean;
}
