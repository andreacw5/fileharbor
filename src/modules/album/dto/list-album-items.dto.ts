import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AlbumResourceType } from '@prisma/client';

export class ListAlbumItemsDto {
  @ApiPropertyOptional({ enum: AlbumResourceType, description: 'Filter by resource type' })
  @IsOptional()
  @IsEnum(AlbumResourceType)
  resourceType?: AlbumResourceType;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number;
}
