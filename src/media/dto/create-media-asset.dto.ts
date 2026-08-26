import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsNumber } from 'class-validator';

export class CreateMediaAssetDto {
  @ApiProperty({ description: 'Titre ou nom du média' })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiProperty({ description: 'Nom de fichier original' })
  @IsNotEmpty()
  @IsString()
  filename: string;

  @ApiProperty({ description: 'URL du média téléversé' })
  @IsNotEmpty()
  @IsString()
  fileUrl: string;

  @ApiPropertyOptional({ description: 'URL de miniature (pour vidéos/images)' })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiProperty({ description: 'Type de média (audio, video, image)', enum: ['audio', 'video', 'image'] })
  @IsNotEmpty()
  @IsString()
  type: 'audio' | 'video' | 'image';

  @ApiPropertyOptional({ description: 'MIME Type (ex: audio/mpeg, video/mp4)' })
  @IsOptional()
  @IsString()
  mimeType?: string;

  @ApiPropertyOptional({ description: 'Taille du fichier en octets' })
  @IsOptional()
  @IsNumber()
  size?: number;

  @ApiPropertyOptional({ description: 'Durée en secondes' })
  @IsOptional()
  @IsNumber()
  duration?: number;

  @ApiPropertyOptional({ description: 'Format court (MP3, WAV, MP4, JPG, PNG)' })
  @IsOptional()
  @IsString()
  format?: string;
}
