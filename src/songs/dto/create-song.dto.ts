import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  IsUUID,
  IsArray,
  ArrayMinSize,
  IsBoolean,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSongDto {
  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  isMonetized?: boolean;

  @ApiProperty({ required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  price?: number;

  @ApiProperty({ required: false })
  @IsInt()
  @Min(1)
  @IsOptional()
  discountPrice?: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty()
  @IsInt()
  duration: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  coverUrl?: string;

  @ApiProperty()
  @IsBoolean()
  isSingle: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  isAcademic?: boolean;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  audioUrl: string;

  @ApiProperty({ required: false, type: [String] })
  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  artistIds?: string[];

  @ApiProperty({ required: false, type: [String] })
  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  groupIds?: string[];

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  albumId?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  genreId?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  genreIds?: string[];
}
