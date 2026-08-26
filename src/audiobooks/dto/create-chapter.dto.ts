import { IsString, IsNotEmpty, IsOptional, IsInt } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateChapterDto {
  @ApiProperty({ description: 'Titre du chapitre' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ description: 'Durée en secondes', default: 0 })
  @IsInt()
  @IsOptional()
  duration?: number;

  @ApiPropertyOptional({ description: 'Point de départ en secondes', default: 0 })
  @IsInt()
  @IsOptional()
  startAt?: number;

  @ApiPropertyOptional({ description: 'URL du fichier audio' })
  @IsString()
  @IsOptional()
  audioUrl?: string;

  @ApiPropertyOptional({ description: 'Ordre du chapitre', default: 0 })
  @IsInt()
  @IsOptional()
  order?: number;

  @ApiPropertyOptional({ description: 'Texte source / manuscrit / transcription du chapitre' })
  @IsString()
  @IsOptional()
  text?: string;

  @ApiPropertyOptional({ description: 'Source de la narration', default: 'HUMAN', enum: ['HUMAN', 'TTS'] })
  @IsString()
  @IsOptional()
  audioSource?: string;

  @ApiPropertyOptional({ description: 'Statut du chapitre', default: 'READY', enum: ['READY', 'PENDING', 'PROCESSING', 'FAILED'] })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ description: 'Métadonnées de timestamps / synchronisation texte-audio' })
  @IsOptional()
  timestamps?: any;
}
