import {
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateVideoDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  videoUrl: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  mediaAssetId?: string | null;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  thumbnailUrl?: string;

  @ApiProperty()
  @IsInt()
  duration: number;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsArray()
  @ArrayMaxSize(20)
  @IsOptional()
  @IsString({ each: true })
  tags?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  genreId?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  artistIds?: string[];

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @IsUUID()
  channelId?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  videoPlaylistIds?: string[];

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  isAcademic?: boolean;

  @IsOptional()
  @IsBoolean()
  isMonetized?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  discountPrice?: number | null;
}

