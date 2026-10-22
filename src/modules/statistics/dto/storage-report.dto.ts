import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { PageParams } from '@heyatom/nest-common';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Filters live on the DTO: the global pipe forbids undeclared query params. */
export class StorageReportQuery {
  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'First day (UTC), default `to` - 29 days',
  })
  @IsOptional()
  @Matches(DAY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-30',
    description:
      'Last day (UTC, included), default today. Max 366 days from `from`.',
  })
  @IsOptional()
  @Matches(DAY, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({ description: 'Only this client' })
  @IsOptional()
  @IsUUID()
  clientId?: string;
}

export class CreatorStorageQuery extends PageParams {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ description: 'Only this client' })
  @IsOptional()
  @IsUUID()
  clientId?: string;
}

class KindUsageDto {
  @ApiProperty() count: number;
  @ApiProperty({ description: 'Bytes' }) bytes: number;
}

export class StorageSeriesPointDto {
  @ApiProperty({ example: '2026-10-22' }) date: string;
  @ApiProperty({ nullable: true, type: Number }) images: number | null;
  @ApiProperty({ nullable: true, type: Number }) videos: number | null;
  @ApiProperty({ nullable: true, type: Number }) avatars: number | null;
}

export class ClientStorageDto {
  @ApiProperty() clientId: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: KindUsageDto }) images: KindUsageDto;
  @ApiProperty({ type: KindUsageDto }) videos: KindUsageDto;
  @ApiProperty({ type: KindUsageDto }) avatars: KindUsageDto;
}

export class StorageReportDto {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'First snapshot in scope: the series is real from this day',
  })
  firstSnapshot: string | null;
  @ApiProperty({
    type: [StorageSeriesPointDto],
    description: 'One point per day, bytes; null on days with no snapshot',
  })
  series: StorageSeriesPointDto[];
  @ApiProperty({
    type: [ClientStorageDto],
    description: 'Live, biggest first',
  })
  byClient: ClientStorageDto[];
}

export class CreatorStorageDto {
  @ApiProperty() creatorId: string;
  @ApiProperty() externalId: string;
  @ApiProperty({ nullable: true, type: String }) username: string | null;
  @ApiProperty() clientId: string;
  @ApiProperty({ description: 'Bytes' }) images: number;
  @ApiProperty({ description: 'Bytes' }) videos: number;
  @ApiProperty({ description: 'Bytes' }) avatars: number;
  @ApiProperty() totalBytes: number;
  @ApiProperty() itemCount: number;
}
