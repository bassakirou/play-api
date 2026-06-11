import { IsEmail } from 'class-validator';

export class CreateMaintenanceSubscriptionDto {
  @IsEmail()
  email!: string;
}
