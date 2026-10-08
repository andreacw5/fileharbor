import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AlbumResourceType } from '@prisma/client';

export class RemoveAlbumItemDto {
  @ApiProperty({ description: 'UUID of the image or video' })
  @IsUUID()
  id: string;

  @ApiProperty({ enum: AlbumResourceType })
  @IsEnum(AlbumResourceType)
  resourceType: AlbumResourceType;
}

export class RemoveAlbumItemsDto {
  @ApiProperty({ type: [RemoveAlbumItemDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RemoveAlbumItemDto)
  items: RemoveAlbumItemDto[];
}
