import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

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
}

export class SetPaperQuestionsDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  questionIds: string[];
}

