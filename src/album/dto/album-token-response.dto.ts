import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AlbumTokenResponseDto {
  @ApiProperty({
    description: 'Access token for the album',
    example: 'abc123-xyz789-token',
  })
  token: string;

  @ApiProperty({
    description: 'Album identifier',
    example: 'album-uuid-123',
  })
  albumId: string;

  @ApiPropertyOptional({
    description: 'Token expiration timestamp (null for no expiration)',
    example: '2025-11-05T12:00:00.000Z',
    nullable: true,
  })
  expiresAt?: Date | null;

  @ApiProperty({
    description: 'URL to access the album with the token',
    example: '/v2/albums/shared/abc123-xyz789-token',
  })
  url: string;
}

