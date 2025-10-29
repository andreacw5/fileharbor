import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AlbumResponseDto {
  @ApiProperty({
    description: 'Unique album identifier (UUID)',
    example: 'album-uuid-123',
  })
  id: string;

  @ApiProperty({
    description: 'Client identifier',
    example: 'demo.fileharbor.local',
  })
  clientId: string;

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
    description: 'Array of images in the album',
    type: [Object],
  })
  images?: any[];
}

