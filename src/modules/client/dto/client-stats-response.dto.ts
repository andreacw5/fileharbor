import { ApiProperty } from '@nestjs/swagger';

export class ClientStatsResponseDto {
  @ApiProperty({ example: 42, description: 'Total number of images for this client' })
  totalImages: number;

  @ApiProperty({ example: 7, description: 'Total number of albums for this client' })
  totalAlbums: number;

  @ApiProperty({ example: 10485760, description: 'Total storage used in bytes for this client' })
  totalStorage: number;


  @ApiProperty({ example: 7, description: 'Images added on last 7 days' })
  uploadedLast7Days: number;
}
