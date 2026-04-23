import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class TagsResponseDto {
  @ApiProperty({ description: 'List of distinct tags used across images', type: [String] })
  @Expose()
  tags: string[];

  @ApiProperty({ description: 'Total number of distinct tags returned' })
  @Expose()
  total: number;
}

