import { IsNotEmpty, IsOptional, IsString, IsBoolean, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateVideoCommentDto {
  @IsNotEmpty({ message: 'Le contenu du commentaire ne peut pas être vide.' })
  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsBoolean()
  isAsCreator?: boolean;
}

export class UpdateVideoCommentDto {
  @IsNotEmpty({ message: 'Le contenu du commentaire ne peut pas être vide.' })
  @IsString()
  content: string;
}

export class QueryStudioCommentsDto {
  @IsOptional()
  @IsString()
  videoId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  unansweredOnly?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
