import { IsString, IsUUID, IsNumber, IsOptional, IsBoolean, IsIn, IsNotEmpty } from 'class-validator';

export class SaveMcqAnswerDto {
  @IsUUID()
  testId: string;

  @IsUUID()
  questionId: string;

  @IsString()
  @IsNotEmpty()
  selectedOption: string;
}

export class SubmitMcqSectionDto {
  @IsUUID()
  testId: string;
}

export class SubmitCodingDto {
  @IsUUID()
  testId: string;

  @IsUUID()
  questionId: string;

  @IsNumber()
  languageId: number;

  @IsString()
  @IsNotEmpty()
  sourceCode: string;
}

export class FinalSubmitDto {
  @IsUUID()
  testId: string;

  @IsBoolean()
  @IsOptional()
  isAutoSubmit?: boolean;
}

export class AntiCheatDto {
  @IsUUID()
  testId: string;

  @IsIn(['tab_switch', 'fullscreen_exit', 'copy_paste'])
  type: 'tab_switch' | 'fullscreen_exit' | 'copy_paste';
}

export class TrackQuestionTimeDto {
  @IsUUID()
  testId: string;

  @IsUUID()
  questionId: string;

  @IsNumber()
  timeSpentSeconds: number;
}
