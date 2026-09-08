import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PageParams } from '@/common/pagination';

export class TagListItemDto {
  @ApiProperty({ description: 'Tag name', example: 'nature' })
  name: string;

  @ApiProperty({ description: 'Number of images associated with this tag', example: 42 })
  imageCount: number;
}

/** Tag pages are wider than default: they feed autocompletes. */
export class TagPageParams extends PageParams {
  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit: number = 200;
}

class TagMetaDto {
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}

export class TagsResponseDto {
  @ApiProperty({ type: [TagListItemDto] })
  data: TagListItemDto[];

  @ApiProperty({ type: TagMetaDto })
  meta: TagMetaDto;
}
