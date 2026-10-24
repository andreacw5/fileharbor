import { IsDate, IsOptional, MinDate } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateShareLinkDto {
  @ApiPropertyOptional({
    description: 'Expiration date for the share link (future)',
    example: '2025-11-05T12:00:00.000Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinDate(() => new Date(), { message: 'expiresAt must be in the future' })
  expiresAt?: Date;
}
