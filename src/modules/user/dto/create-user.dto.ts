import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ description: 'External user ID from the client system' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  externalUserId: string;

  @ApiPropertyOptional({ description: 'Username' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  @ApiPropertyOptional({ description: 'Email address (stored but never returned in list responses)' })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;
}

