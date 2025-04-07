import { ApiProperty } from '@nestjs/swagger';

export class UploadCountPerDayDto {
  @ApiProperty({
    description: 'Date of the upload',
    type: String,
  })
  days: string;
}

export class AvatarStatsDto {
  @ApiProperty({ example: 20 })
  count: number;

  @ApiProperty({ example: 320 })
  totalViews: number;

  @ApiProperty({ example: 16 })
  avgViews: number;

  @ApiProperty({ example: 700000 })
  totalSizeBytes: number;

  @ApiProperty({ example: 60 })
  percentOptimized: number;
}

export class FileStatsDto {
  @ApiProperty({ example: 50 })
  count: number;

  @ApiProperty({ example: 1000 })
  totalViews: number;

  @ApiProperty({ example: 400 })
  totalDownloads: number;

  @ApiProperty({ example: 20 })
  avgViews: number;

  @ApiProperty({ example: 5000000 })
  totalSizeBytes: number;

  @ApiProperty({ example: 80 })
  percentOptimized: number;
}

export class UploadsPerDayDto {
  @ApiProperty({ type: UploadCountPerDayDto })
  avatars: UploadCountPerDayDto;

  @ApiProperty({ type: UploadCountPerDayDto })
  files: UploadCountPerDayDto;
}

export class TotalsStatsDto {
  @ApiProperty({ type: AvatarStatsDto })
  avatars: AvatarStatsDto;

  @ApiProperty({ type: FileStatsDto })
  files: FileStatsDto;
}

export class DomainStatisticsDto {
  @ApiProperty({ example: 'example.com' })
  domain: string;

  @ApiProperty({ example: '30 days' })
  period: string;

  @ApiProperty({ type: TotalsStatsDto })
  totals: TotalsStatsDto;

  @ApiProperty({ type: UploadsPerDayDto })
  uploadsPerDay: UploadsPerDayDto;
}
