import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';

export class ShareLinkResponseDto {
  @ApiProperty({
    description: 'Unique share link identifier (UUID)',
    example: 'abc-123-def-456',
  })
  @Expose()
  id: string;

  @ApiProperty({
    description: 'Image identifier',
    example: 'b2ce77c1-3836-4e28-807f-51f929e12423',
  })
  @Expose()
  imageId: string;

  @ApiProperty({
    description: 'Access token for the share link',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @Expose()
  readToken: string;

  @ApiProperty({
    description: 'Share link creation timestamp',
    example: '2025-10-29T12:00:00.000Z',
  })
  @Expose()
  @Type(() => Date)
  createdAt: Date;

  @ApiPropertyOptional({
    description: 'Share link expiration timestamp (optional)',
    example: '2025-11-05T12:00:00.000Z',
  })
  @Expose()
  @Type(() => Date)
  expiresAt?: Date;

  @ApiProperty({
    description: 'Full URL to access the shared image',
    example: '/v2/images/shared/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @Expose()
  shareUrl: string;
}

