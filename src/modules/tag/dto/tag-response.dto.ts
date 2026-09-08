import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { PageParams } from '@/common/pagination';

export class TagTagClientDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() domain?: string;
}

export class TagListItemDto {
  @ApiProperty({ description: 'Tag row id' })
  id: string;

  @ApiProperty({ description: 'Tag name', example: 'nature' })
  name: string;

  @ApiProperty({ description: 'Client this tag row belongs to' })
  clientId: string;

  /**
   * A tag is unique per `(clientId, name)`, so a query spanning several clients
   * returns the same name once per client. Without this the rows are
   * indistinguishable.
   */
  @ApiPropertyOptional({ type: TagTagClientDto })
  client?: TagTagClientDto;

  @ApiProperty({ description: 'Number of images associated with this tag', example: 42 })
  imageCount: number;

  @ApiProperty({ description: 'Number of videos associated with this tag', example: 3 })
  videoCount: number;
}

/**
 * Tag pages are wider than default: they feed autocompletes.
 *
 * The filters live here rather than on separate `@Query('clientId')` params
 * because the global ValidationPipe runs with `forbidNonWhitelisted: true`: a
 * `@Query()` bound to a DTO is validated against the *whole* query string, so
 * any field this class does not declare is rejected with a 400.
 */
export class TagPageParams extends PageParams {
  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit: number = 200;

  @ApiPropertyOptional({ description: 'Scope to a specific client' })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({ description: 'Filter tags by partial match' })
  @IsOptional()
  @IsString()
  search?: string;
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
