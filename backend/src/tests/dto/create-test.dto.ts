import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsDateString,
  Min,
  IsBoolean,
} from 'class-validator';

export class CreateTestDto {
  @IsString()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(1)
  durationMinutes: number;

  @IsDateString()
  @IsOptional()
  startsAt?: string;

  @IsDateString()
  @IsOptional()
  endsAt?: string;

  @IsArray()
  @IsOptional()
  allowedLanguages?: number[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  hasSections?: boolean;

  @IsNumber()
  @IsOptional()
  mcqCutoffPercent?: number;

  @IsNumber()
  @IsOptional()
  negativeMarkValue?: number;

  @IsNumber()
  @IsOptional()
  mcqTimeMinutes?: number;

  @IsNumber()
  @IsOptional()
  codingTimeMinutes?: number;
}

export class UpdateTestDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  durationMinutes?: number;

  @IsDateString()
  @IsOptional()
  startsAt?: string;

  @IsDateString()
  @IsOptional()
  endsAt?: string;

  @IsArray()
  @IsOptional()
  allowedLanguages?: number[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  hasSections?: boolean;

  @IsNumber()
  @IsOptional()
  mcqCutoffPercent?: number;

  @IsNumber()
  @IsOptional()
  negativeMarkValue?: number;

  @IsNumber()
  @IsOptional()
  mcqTimeMinutes?: number;

  @IsNumber()
  @IsOptional()
  codingTimeMinutes?: number;
}
