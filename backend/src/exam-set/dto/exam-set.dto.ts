import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSetDto {
  @IsString()
  @MaxLength(64)
  name: string;

  @IsString()
  @MaxLength(32)
  @IsOptional()
  code?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateSetDto {
  @IsString()
  @MaxLength(64)
  @IsOptional()
  name?: string;

  @IsString()
  @MaxLength(32)
  @IsOptional()
  code?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
