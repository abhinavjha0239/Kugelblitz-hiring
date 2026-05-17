import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  IsBoolean,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QuestionType } from '../question.entity';

export class McqOptionDto {
  @IsString()
  id: string;

  @IsString()
  text: string;

  @IsString()
  @IsOptional()
  imageUrl?: string;
}

export class CreateTestCaseDto {
  @IsString()
  input: string;

  @IsString()
  expectedOutput: string;

  @IsBoolean()
  @IsOptional()
  isHidden?: boolean;
}

export class CreateQuestionDto {
  @IsUUID()
  testId: string;

  @IsEnum(QuestionType)
  type: QuestionType;

  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  marks?: number;

  @IsNumber()
  @IsOptional()
  orderIndex?: number;

  @IsNumber()
  @IsOptional()
  section?: number;

  @IsNumber()
  @IsOptional()
  negativeMarks?: number;

  @IsArray()
  @IsOptional()
  allowedLanguages?: number[];

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  imageUrls?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => McqOptionDto)
  @IsOptional()
  mcqOptions?: McqOptionDto[];

  @IsString()
  @IsOptional()
  mcqCorrectAnswer?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTestCaseDto)
  @IsOptional()
  testCases?: CreateTestCaseDto[];
}

export class UpdateQuestionDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  marks?: number;

  @IsNumber()
  @IsOptional()
  orderIndex?: number;

  @IsNumber()
  @IsOptional()
  section?: number;

  @IsNumber()
  @IsOptional()
  negativeMarks?: number;

  @IsArray()
  @IsOptional()
  allowedLanguages?: number[];

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  imageUrls?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => McqOptionDto)
  @IsOptional()
  mcqOptions?: McqOptionDto[];

  @IsString()
  @IsOptional()
  mcqCorrectAnswer?: string;
}
