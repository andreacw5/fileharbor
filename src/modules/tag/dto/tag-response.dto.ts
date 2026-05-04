import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';

export class TagListItemDto {
  @ApiProperty({ description: 'Tag name', example: 'nature' })
  @Expose()
  name: string;

  @ApiProperty({ description: 'Number of images associated with this tag', example: 42 })
  @Expose()
  imageCount: number;
}

export class TagsResponseDto {
  @ApiProperty({ description: 'List of distinct tags used across images', type: [TagListItemDto] })
  @Expose()
  @Type(() => TagListItemDto)
  tags: TagListItemDto[];

  @ApiProperty({ description: 'Total number of distinct tags returned' })
  @Expose()
  total: number;
}

