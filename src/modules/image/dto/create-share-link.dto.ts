import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateShareLinkDto {
  @ApiPropertyOptional({
    description: 'Expiration date for the share link',
    example: '2025-11-05T12:00:00.000Z'
  })
  @IsOptional()
  @IsString()
  expiresAt?: string;
}

