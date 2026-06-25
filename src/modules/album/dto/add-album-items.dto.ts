import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsInt, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AlbumResourceType } from '@prisma/client';

export class AddAlbumItemDto {
  @ApiProperty({ description: 'UUID of the image or video' })
  @IsUUID()
  id: string;

  @ApiProperty({ enum: AlbumResourceType })
  @IsEnum(AlbumResourceType)
  resourceType: AlbumResourceType;

  @ApiPropertyOptional({ description: 'Sort order within the album' })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class AddAlbumItemsDto {
  @ApiProperty({ type: [AddAlbumItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddAlbumItemDto)
  items: AddAlbumItemDto[];
}

export class AddAlbumItemsResponseDto {
  @ApiProperty() albumId: string;
  @ApiProperty() count: number;
  @ApiProperty({ type: [Object] }) items: { id: string; resourceType: string; order: number }[];
}
