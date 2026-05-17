import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export type CutoffType = 'percent' | 'marks' | 'none';
export type CutoffFailBehavior = 'end_exam' | 'lock_next' | 'none';

export class CreatePaperDto {
  @IsUUID()
  examId: string;

  @IsString()
  name: string;

  @IsInt()
  @Min(1)
  order: number;

  @IsInt()
  @Min(1)
  @Max(500)
  totalQuestions: number;

  @IsInt()
  @Min(1)
  @Max(600)
  durationMinutes: number;

  @IsBoolean()
  @IsOptional()
  passRequired?: boolean;

  @IsEnum(['percent', 'marks', 'none'])
  @IsOptional()
  cutoffType?: CutoffType;

  @IsNumber()
  @Min(0)
  @IsOptional()
  cutoffValue?: number;

  @IsEnum(['end_exam', 'lock_next', 'none'])
  @IsOptional()
  cutoffFailBehavior?: CutoffFailBehavior;
}

export class UpdatePaperDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  order?: number;

  @IsInt()
  @Min(1)
  @Max(500)
  @IsOptional()
  totalQuestions?: number;

  @IsInt()
  @Min(1)
  @Max(600)
  @IsOptional()
  durationMinutes?: number;

  @IsBoolean()
  @IsOptional()
  passRequired?: boolean;

  @IsEnum(['percent', 'marks', 'none'])
  @IsOptional()
  cutoffType?: CutoffType;

  @IsNumber()
  @Min(0)
  @IsOptional()
  cutoffValue?: number;

  @IsEnum(['end_exam', 'lock_next', 'none'])
  @IsOptional()
  cutoffFailBehavior?: CutoffFailBehavior;
}

export class SetPaperQuestionsDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  questionIds: string[];
}

