import { IsString, IsUUID, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class AdminResetPasswordDto {
  @IsUUID()
  userId: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}
