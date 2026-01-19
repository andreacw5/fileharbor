import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform, Type } from 'class-transformer';

export class ImageResponseDto {
  @ApiProperty({
    description: 'Unique image identifier (UUID)',
    example: 'b2ce77c1-3836-4e28-807f-51f929e12423',
  })
  @Expose()
  id: string;


  @ApiProperty({
    description: 'User identifier who uploaded the image',
    example: 'user-123',
  })
  userId: string;

  @ApiProperty({
    description: 'User identifier who uploaded the image',
    example: 'user-123',
  })
  @Expose()
  user: object;

  @ApiProperty({
    description: 'User identifier who uploaded the image',
    example: 'user-123',
  })
  @Expose()
  client: object;

  @ApiProperty({
    description: 'Original filename',
    example: 'sunset.jpg',
  })
  @Expose()
  originalName: string;

  @ApiProperty({
    description: 'Image format',
    example: 'webp',
    enum: ['webp', 'jpeg', 'png', 'gif'],
  })
  @Expose()
  format: string;

  @ApiProperty({
    description: 'Image width in pixels',
    example: 1920,
  })
  @Expose()
  width: number;

  @ApiProperty({
    description: 'Image height in pixels',
    example: 1080,
  })
  @Expose()
  height: number;

  @ApiProperty({
    description: 'File size in bytes',
    example: 245678,
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
    description: 'Whether the image has been optimized',
    example: true,
  })
  @Expose()
  isOptimized: boolean;

  @ApiProperty({
    description: 'Whether the image is private',
    example: false,
  })
  @Expose()
  @Transform(({ value }) => value || false)
  isPrivate: boolean;

  @ApiProperty({
    description: 'Image tags for categorization',
    type: [String],
    example: ['nature', 'landscape', 'sunset'],
  })
  @Expose()
  @Transform(({ value }) => value || [])
  tags: string[];

  @ApiProperty({
    description: 'Number of times the image has been viewed',
    example: 42,
  })
  @Expose()
  @Transform(({ value }) => value || 0)
  views: number;

  @ApiProperty({
    description: 'Number of times the image has been downloaded',
    example: 5,
  })
  @Expose()
  @Transform(({ value }) => value || 0)
  downloads: number;

  @ApiPropertyOptional({
    description: 'Image description',
    example: 'Beautiful sunset over the mountains',
  })
  @Expose()
  description?: string;

  @ApiProperty({
    description: 'Upload timestamp',
    example: '2025-10-29T12:00:00.000Z',
  })
  @Expose()
  @Type(() => Date)
  createdAt: Date;

  @ApiProperty({
    description: 'URL to access the image',
    example: '/v2/images/b2ce77c1-3836-4e28-807f-51f929e12423',
  })
  @Expose()
  url: string;

  @ApiPropertyOptional({
    description: 'URL to access the thumbnail',
    example: '/v2/images/b2ce77c1-3836-4e28-807f-51f929e12423?thumb=true',
  })
  @Expose()
  thumbnailUrl?: string;

  @ApiProperty({
    description: 'Full URL to access the image (baseUrl + url)',
    example: 'http://localhost:3000/v2/images/b2ce77c1-3836-4e28-807f-51f929e12423',
  })
  @Expose()
  fullPath: string;
}

