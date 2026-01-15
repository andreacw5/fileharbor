import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class PaginationMetaDto {
  @ApiProperty({
    description: 'Current page number',
    example: 1,
  })
  @Expose()
  page: number;

  @ApiProperty({
    description: 'Items per page',
    example: 20,
  })
  @Expose()
  perPage: number;

  @ApiProperty({
    description: 'Total number of items',
    example: 150,
  })
  @Expose()
  total: number;

  @ApiProperty({
    description: 'Total number of pages',
    example: 8,
  })
  @Expose()
  totalPages: number;
}

