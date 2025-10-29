import { ApiProperty } from '@nestjs/swagger';

export class StatsResponseDto {
  @ApiProperty({ example: 42 })
  totalImages: number;

  @ApiProperty({ example: 7 })
  totalAlbums: number;

  @ApiProperty({ example: 10485760, description: 'Total storage used in bytes' })
  totalStorage: number;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'b2ce77c1-3836-4e28-807f-51f929e12423' },
        originalName: { type: 'string', example: 'photo.jpg' },
        downloads: { type: 'number', example: 123 },
        size: { type: 'number', example: 204800 },
      },
    },
    description: 'Top 5 most downloaded images',
  })
  topImages: Array<{
    id: string;
    originalName: string;
    downloads: number;
    size: number;
  }>;
}

