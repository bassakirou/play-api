import { ArrayNotEmpty, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsString, Length, Max, Min } from 'class-validator';

export const CREATOR_PLAN_TYPES = ['SONG', 'ALBUM', 'VIDEO', 'AUDIOBOOK', 'LIVE', 'COURSE'] as const;
export type CreatorPlanType = (typeof CREATOR_PLAN_TYPES)[number];
export const CREATOR_CADENCES = ['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'] as const;
export type CreatorCadence = (typeof CREATOR_CADENCES)[number];

export class CreatorPlanDto {
  @IsString() @Length(1, 80) name: string;
  @IsString() @Length(1, 2000) description: string;
  @IsInt() @Min(1) @Max(2147483647) price: number;
  @IsIn(CREATOR_CADENCES) cadence: CreatorCadence;
  @IsArray() @ArrayNotEmpty() @ArrayUnique() @IsIn(CREATOR_PLAN_TYPES, { each: true }) contentTypes: CreatorPlanType[];
  @IsBoolean() active: boolean;
}
