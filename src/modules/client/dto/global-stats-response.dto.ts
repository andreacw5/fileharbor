import { ApiProperty } from '@nestjs/swagger';

export class GlobalStatsResponseDto {
  @ApiProperty({ example: 1042, description: 'Total number of images across all clients' })
  totalImages: number;

  @ApiProperty({ example: 10485760, description: 'Total storage used in bytes across all clients' })
  totalStorage: number;
}

