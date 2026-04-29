import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ConfirmQuestionDto {
  @IsString()
  @IsNotEmpty()
  text: string;

  @IsArray()
  @IsString({ each: true })
  options: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  correctOption?: number | null;

  @IsIn(['aptitude', 'critical', 'psychometric'])
  module: 'aptitude' | 'critical' | 'psychometric';
}

export class ConfirmPdfUploadDto {
  @IsUUID()
  uploadId: string;

  @IsUUID()
  testId: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmQuestionDto)
  questions?: ConfirmQuestionDto[];
}
