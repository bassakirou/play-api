import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
} from 'class-validator';

export class CreateCourseDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  subtitle?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  thumbnailUrl?: string;

  @IsString()
  @IsOptional()
  previewVideoUrl?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  level?: string;

  @IsString()
  @IsOptional()
  language?: string;

  @IsNumber()
  @IsOptional()
  durationHours?: number;

  @IsArray()
  @IsOptional()
  learningOutcomes?: string[];

  @IsArray()
  @IsOptional()
  requirements?: string[];

  @IsString()
  @IsOptional()
  instructorBio?: string;

  @IsString()
  @IsOptional()
  instructorTitle?: string;
}

export class UpdateCourseDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  subtitle?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  thumbnailUrl?: string;

  @IsString()
  @IsOptional()
  previewVideoUrl?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  level?: string;

  @IsString()
  @IsOptional()
  language?: string;

  @IsNumber()
  @IsOptional()
  durationHours?: number;

  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;

  @IsBoolean()
  @IsOptional()
  isFeatured?: boolean;

  @IsArray()
  @IsOptional()
  learningOutcomes?: string[];

  @IsArray()
  @IsOptional()
  requirements?: string[];

  @IsString()
  @IsOptional()
  instructorBio?: string;

  @IsString()
  @IsOptional()
  instructorTitle?: string;
}

export class CreateModuleDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsNumber()
  @IsOptional()
  order?: number;
}

export class CreateLessonDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  contentType?: string;

  @IsString()
  @IsOptional()
  contentUrl?: string;

  @IsNumber()
  @IsOptional()
  durationSeconds?: number;

  @IsNumber()
  @IsOptional()
  order?: number;

  @IsBoolean()
  @IsOptional()
  isFreePreview?: boolean;

  @IsOptional()
  resources?: any;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateProgressDto {
  @IsString()
  @IsNotEmpty()
  lessonId: string;

  @IsBoolean()
  @IsOptional()
  completed?: boolean;
}
