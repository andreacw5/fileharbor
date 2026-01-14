import { ApiProperty } from '@nestjs/swagger';

export class ListAlbumsResponseDto {
  @ApiProperty({
    description: 'Array of albums',
    type: [Object],
  })
  data: any[];

  @ApiProperty({
    description: 'Pagination metadata',
    example: {
      page: 1,
      perPage: 20,
      total: 100,
      totalPages: 5,
    },
  })
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
}

