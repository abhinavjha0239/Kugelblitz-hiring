import { IsString, IsNumber, IsUUID, IsOptional, IsBoolean } from 'class-validator';

export class CreateSubmissionDto {
  @IsUUID()
  questionId: string;

  @IsUUID()
  testId: string;

  @IsNumber()
  languageId: number;

  @IsString()
  sourceCode: string;

  @IsBoolean()
  @IsOptional()
  isFinal?: boolean;
}

export class RunCodeDto {
  @IsNumber()
  languageId: number;

  @IsString()
  sourceCode: string;

  @IsString()
  @IsOptional()
  stdin?: string;
}
