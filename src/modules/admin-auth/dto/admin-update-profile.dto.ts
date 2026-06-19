import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsUrl, IsEmail, MaxLength, MinLength } from 'class-validator';

export class AdminUpdateProfileDto {
  @ApiPropertyOptional({ description: 'Per-app display name (overrides Bastion username when set)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  username?: string;

  @ApiPropertyOptional({ description: 'Per-app avatar URL (overrides Bastion image when set)' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  image?: string;
}

export class UpdateEmailDto {
  @ApiProperty({ description: 'New email address — triggers verification flow on Bastion' })
  @IsEmail()
  email: string;
}

export class ConfirmTokenDto {
  @ApiProperty({ description: 'One-time token from the email link' })
  @IsString()
  token: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(8)
  currentPassword: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: 'dbd', description: 'Required when fileharbor app is registered in multiple tenants' })
  @IsOptional()
  @IsString()
  tenantSlug?: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'One-time token from the password reset email link' })
  @IsString()
  token: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}
