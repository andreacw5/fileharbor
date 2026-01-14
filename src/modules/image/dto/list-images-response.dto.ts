import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { ImageResponseDto } from './image-response.dto';
import { PaginationMetaDto } from './pagination-meta.dto';

export class ListImagesResponseDto {
  @ApiProperty({
    description: 'Array of images',
    type: [ImageResponseDto],
  })
  @Expose()
  @Type(() => ImageResponseDto)
  data: ImageResponseDto[];

  @ApiProperty({
    description: 'Pagination metadata',
    type: PaginationMetaDto,
  })
  @Expose()
  @Type(() => PaginationMetaDto)
  pagination: PaginationMetaDto;
}

