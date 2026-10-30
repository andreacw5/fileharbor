import { IsDate, IsOptional, MaxDate, MinDate } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ADMIN_SHARE_LINK_MAX_DAYS } from '@/modules/admin/dto/admin-share-link.dto';

export class CreateShareLinkDto {
  @ApiPropertyOptional({
    description: `Expiration date for the share link: in the future, at most ${ADMIN_SHARE_LINK_MAX_DAYS} days out. Omitted: the link never expires.`,
    example: '2025-11-05T12:00:00.000Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinDate(() => new Date(), { message: 'expiresAt must be in the future' })
  @MaxDate(
    () => new Date(Date.now() + ADMIN_SHARE_LINK_MAX_DAYS * 86_400_000),
    {
      message: `expiresAt must be within ${ADMIN_SHARE_LINK_MAX_DAYS} days`,
    },
  )
  expiresAt?: Date;
}
