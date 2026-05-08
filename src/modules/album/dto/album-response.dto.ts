import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AlbumResponseDto {
  @ApiProperty({
    description: 'Unique album identifier (UUID)',
    example: 'album-uuid-123',
  })
  id: string;

  @ApiPropertyOptional({
    description: 'External album ID from the client application',
    example: 'ext-album-123',
  })
  externalAlbumId?: string;

  @ApiProperty({
    description: 'User identifier who owns the album',
    example: 'user-123',
  })
  userId: string;

  @ApiProperty({
    description: 'Album name',
    example: 'Vacation Photos 2025',
  })
  name: string;

  @ApiPropertyOptional({
    description: 'Album description',
    example: 'Photos from our summer vacation',
  })
  description?: string;

  @ApiProperty({
    description: 'Whether the album is public',
    example: true,
  })
  isPublic: boolean;

  @ApiPropertyOptional({
    description: 'Cover image ID',
    example: 'image-uuid-123',
  })
  coverImageId?: string;

  @ApiProperty({
    description: 'Album creation timestamp',
    example: '2025-10-29T12:00:00.000Z',
  })
  createdAt: Date;

  @ApiPropertyOptional({
    description: 'Number of images in the album',
    example: 24,
  })
  imageCount?: number;

  @ApiPropertyOptional({
    description: 'Cover image URL (first image in the album)',
    example: 'http://localhost:3000/v2/images/b2ce77c1-3836-4e28-807f-51f929e12423',
  })
  coverUrl?: string;

  @ApiPropertyOptional({
    description: 'Array of images in the album',
    type: [Object],
  })
  images?: any[];
}
