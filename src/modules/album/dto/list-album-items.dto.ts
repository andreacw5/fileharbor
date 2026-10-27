import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { AlbumResourceType } from '@prisma/client';
import { PageParams } from '@heyatom/nest-common';

export class ListAlbumItemsDto extends PageParams {
  @ApiPropertyOptional({
    enum: AlbumResourceType,
    description: 'Filter by resource type',
  })
  @IsOptional()
  @IsEnum(AlbumResourceType)
  resourceType?: AlbumResourceType;
}
