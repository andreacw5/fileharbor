import { IsOptional, IsNumber, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateAlbumTokenDto {
  @ApiPropertyOptional({
    description: 'Token expiration in days (default: 7, null for no expiration)',
    minimum: 1,
    example: 7,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  expiresInDays?: number;
}

