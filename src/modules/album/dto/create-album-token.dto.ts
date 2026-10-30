import { IsOptional, IsNumber, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export const ALBUM_TOKEN_DEFAULT_DAYS = 7;
export const ALBUM_TOKEN_MAX_DAYS = 365;

export class CreateAlbumTokenDto {
  @ApiPropertyOptional({
    description: `Token expiration in days (default: ${ALBUM_TOKEN_DEFAULT_DAYS}). Every token expires.`,
    minimum: 1,
    maximum: ALBUM_TOKEN_MAX_DAYS,
    default: ALBUM_TOKEN_DEFAULT_DAYS,
    example: 7,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(ALBUM_TOKEN_MAX_DAYS)
  expiresInDays?: number;
}
