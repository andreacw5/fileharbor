import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class AvatarResponseDto {
  @ApiProperty({
    description: 'Unique avatar identifier (UUID)',
    example: 'avatar-uuid-123',
  })
  @Expose()
  id: string;


  @ApiProperty({
    description: 'User identifier who owns the avatar',
    example: 'user-123',
  })
  @Expose()
  userId: string;

  @ApiProperty({
    description: 'Image format',
    example: 'webp',
    enum: ['webp', 'jpeg', 'png', 'gif'],
  })
  @Expose()
  format: string;

  @ApiProperty({
    description: 'Avatar width in pixels',
    example: 512,
  })
  @Expose()
  width: number;

  @ApiProperty({
    description: 'Avatar height in pixels',
    example: 512,
  })
  @Expose()
  height: number;

  @ApiProperty({
    description: 'File size in bytes',
    example: 45678,
  })
  @Expose()
  size: number;

  @ApiProperty({
    description: 'MIME type',
    example: 'image/webp',
  })
  @Expose()
  mimeType: string;

  @ApiProperty({
    description: 'Whether the avatar has been optimized',
    example: true,
  })
  @Expose()
  isOptimized: boolean;

  @ApiProperty({
    description: 'Avatar upload timestamp',
    example: '2025-10-29T12:00:00.000Z',
  })
  @Expose()
  createdAt: Date;

  @ApiProperty({
    description: 'URL to access the avatar',
    example: '/v2/avatars/user-123',
  })
  @Expose()
  url: string;

  @ApiPropertyOptional({
    description: 'URL to access the avatar thumbnail',
    example: '/v2/avatars/user-123?thumb=true',
  })
  @Expose()
  thumbnailUrl?: string;
}

