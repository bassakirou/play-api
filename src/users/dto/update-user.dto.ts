import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';
import { IsOptional, IsString, IsBoolean } from 'class-validator';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  resetToken?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
  })
  @IsOptional()
  resetTokenExpiry?: Date | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  verificationCode?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
  })
  @IsOptional()
  verificationCodeExpiry?: Date | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEmailVerified?: boolean;
}
