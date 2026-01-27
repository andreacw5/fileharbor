import { ApiProperty } from '@nestjs/swagger';

export class ClientStatsResponseDto {
  @ApiProperty({ example: 42, description: 'Total number of images for this client' })
  totalImages: number;

  @ApiProperty({ example: 7, description: 'Total number of albums for this client' })
  totalAlbums: number;

  @ApiProperty({ example: 10485760, description: 'Total storage used in bytes for this client' })
  totalStorage: number;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'b2ce77c1-3836-4e28-807f-51f929e12423' },
        originalName: { type: 'string', example: 'photo.jpg' },
        views: { type: 'number', example: 123 },
        size: { type: 'number', example: 204800 },
      },
    },
    description: 'Top 5 most downloaded images for this client',
  })
  topImages: Array<{
    id: string;
    originalName: string;
    views: number;
    size: number;
  }>;
}
