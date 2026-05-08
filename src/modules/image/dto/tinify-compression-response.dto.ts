import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { ImageResponseDto } from './image-response.dto';

export class CompressionStatsDto {
  @ApiProperty({
    description: 'Original file size before compression (in bytes)',
    example: 1048576,
  })
  @Expose()
  originalSize: number;

  @ApiProperty({
    description: 'Compressed file size after Tinify compression (in bytes)',
    example: 524288,
  })
  @Expose()
  compressedSize: number;

  @ApiProperty({
    description: 'Bytes saved by compression',
    example: 524288,
  })
  @Expose()
  savedBytes: number;

  @ApiProperty({
    description: 'Percentage of size reduction',
    example: '50.00%',
  })
  @Expose()
  savedPercentage: string;
}

export class TinifyCompressionResponseDto {
  @ApiProperty({
    description: 'Updated image data after compression',
    type: ImageResponseDto,
  })
  @Expose()
  @Type(() => ImageResponseDto)
  image: ImageResponseDto;

  @ApiProperty({
    description: 'Compression statistics',
    type: CompressionStatsDto,
  })
  @Expose()
  @Type(() => CompressionStatsDto)
  compressionStats: CompressionStatsDto;
}

