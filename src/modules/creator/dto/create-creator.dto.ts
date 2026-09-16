import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateCreatorDto {
  @ApiProperty({ description: 'External creator ID from the client system' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  externalId: string;

  @ApiPropertyOptional({ description: 'Username' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  @ApiPropertyOptional({
    description: 'Email address (stored but never returned in list responses)',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ description: 'Website URL or label' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;

  @ApiPropertyOptional({ description: 'Creator biography' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string;
}
