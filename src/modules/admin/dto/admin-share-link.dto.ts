import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsOptional,
  IsUUID,
  MaxDate,
  MinDate,
} from 'class-validator';
import { PageParams } from '@heyatom/nest-common';

/** Share links expire at most this far out (console ones always expire, `X-API-Key` ones may not). */
export const ADMIN_SHARE_LINK_MAX_DAYS = 365;

export const SHARE_LINK_STATUSES = ['active', 'expired', 'all'] as const;
export type ShareLinkStatus = (typeof SHARE_LINK_STATUSES)[number];

/** Filters live on the DTO: the global pipe forbids undeclared query params. */
export class AdminShareLinkListQuery extends PageParams {
  @ApiPropertyOptional({ description: 'Filter by client ID' })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({ description: 'Filter by image ID' })
  @IsOptional()
  @IsUUID()
  imageId?: string;

  @ApiPropertyOptional({ enum: SHARE_LINK_STATUSES, default: 'active' })
  @IsOptional()
  @IsIn(SHARE_LINK_STATUSES)
  status: ShareLinkStatus = 'active';
}

export class AdminCreateShareLinkDto {
  @ApiProperty({ description: 'Image ID (must be private)' })
  @IsUUID()
  imageId: string;

  @ApiProperty({
    description: `Expiry, in the future and at most ${ADMIN_SHARE_LINK_MAX_DAYS} days out`,
    example: '2026-11-05T12:00:00.000Z',
  })
  @Type(() => Date)
  @IsDate()
  @MinDate(() => new Date(), { message: 'expiresAt must be in the future' })
  @MaxDate(
    () => new Date(Date.now() + ADMIN_SHARE_LINK_MAX_DAYS * 86_400_000),
    {
      message: `expiresAt must be within ${ADMIN_SHARE_LINK_MAX_DAYS} days`,
    },
  )
  expiresAt: Date;
}
