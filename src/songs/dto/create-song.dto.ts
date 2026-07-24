import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsUUID,
  IsArray,
  ArrayMinSize,
  IsBoolean,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSongDto {
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
