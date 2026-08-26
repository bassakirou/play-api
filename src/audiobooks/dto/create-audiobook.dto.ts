import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAudiobookDto {
  @ApiProperty({ description: 'Titre du livre audio' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: 'Nom de l\'auteur' })
  @IsString()
  @IsNotEmpty()
  author: string;

  @ApiPropertyOptional({ description: 'ID de l\'utilisateur si auteur inscrit' })
  @IsString()
  @IsOptional()
  authorId?: string;

  @ApiPropertyOptional({ description: 'Nom du narrateur' })
  @IsString()
  @IsOptional()
  narrator?: string;

  @ApiPropertyOptional({ description: 'Description du livre audio' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'URL de la photo de couverture' })
  @IsString()
  @IsOptional()
  coverUrl?: string;

  @ApiPropertyOptional({ description: 'Catégorie du livre audio', default: 'Général' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ description: 'Indique si le livre audio est en tendance', default: false })
  @IsBoolean()
  @IsOptional()
  isTrending?: boolean;

  @ApiPropertyOptional({ description: 'Note d\'évaluation', default: 5.0 })
  @IsNumber()
  @IsOptional()
  rating?: number;

  @ApiPropertyOptional({ description: 'Liste des chapitres initiaux' })
  @IsOptional()
  chapters?: any[];
}
