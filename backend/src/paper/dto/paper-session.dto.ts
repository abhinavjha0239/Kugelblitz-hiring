import { IsObject, IsOptional, IsUUID } from 'class-validator';

export class SubmitPaperDto {
  @IsUUID()
  @IsOptional()
  paperId: string;

  @IsObject()
  @IsOptional()
  answers?: Record<string, string>;
}

export class AutosavePaperAnswersDto {
  @IsUUID()
  paperId: string;

  @IsObject()
  answers: Record<string, string>;
}

