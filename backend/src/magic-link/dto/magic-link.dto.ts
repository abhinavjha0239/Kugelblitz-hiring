import { IsArray, IsEmail, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class InviteRowDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  mobile?: string;

  @IsUUID()
  @IsOptional()
  setId?: string;
}

export class CreateInvitesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InviteRowDto)
  rows: InviteRowDto[];
}

export class CompleteProfileDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  @IsOptional()
  mobile?: string;
}
