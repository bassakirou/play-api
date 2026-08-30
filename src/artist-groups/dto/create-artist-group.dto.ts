import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateArtistGroupDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false, type: [String] })
  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  memberIds?: string[];

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  customMembers?: string | string[];

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  studioUrl?: string;
}
