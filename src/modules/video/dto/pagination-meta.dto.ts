import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class VideoPaginationMetaDto {
  @ApiProperty() @Expose() page: number;
  @ApiProperty() @Expose() perPage: number;
  @ApiProperty() @Expose() total: number;
  @ApiProperty() @Expose() totalPages: number;
}
