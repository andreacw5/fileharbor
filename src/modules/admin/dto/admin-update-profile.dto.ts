import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsEmail,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Match } from '../decorators/match.decorator';

export class AdminUpdateProfileDto {
  @ApiPropertyOptional({ description: 'Display name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Email address' })
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class AdminChangePasswordDto {
  @ApiProperty({ description: 'Current password' })
  @IsString()
  currentPassword: string;

  @ApiProperty({ description: 'New password (min 8 chars)' })
  @IsString()
  @MinLength(8)
  newPassword: string;

  @ApiProperty({ description: 'Confirm new password' })
  @IsString()
  @Match('newPassword', { message: 'confirmPassword must match newPassword' })
  confirmPassword: string;
}

