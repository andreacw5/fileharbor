import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';

export class AlbumItemImageDataDto {
  @ApiProperty() @Expose() id: string;
  @ApiProperty() @Expose() originalName: string;
  @ApiProperty() @Expose() mimeType: string;
  @ApiProperty() @Expose() width: number;
  @ApiProperty() @Expose() height: number;
  @ApiProperty() @Expose() size: number;
  @ApiProperty({ type: [String] }) @Expose() tags: string[];
  @ApiProperty() @Expose() fullPath: string;
  @ApiProperty() @Expose() thumbnailPath: string;
}

export class AlbumItemVideoDataDto {
  @ApiProperty() @Expose() id: string;
  @ApiProperty() @Expose() originalName: string;
  @ApiProperty() @Expose() mimeType: string;
  @ApiPropertyOptional() @Expose() duration?: number;
  @ApiPropertyOptional() @Expose() width?: number;
  @ApiPropertyOptional() @Expose() height?: number;
  @ApiProperty() @Expose() size: number;
  @ApiProperty({ type: [String] }) @Expose() tags: string[];
  @ApiProperty() @Expose() url: string;
  @ApiProperty() @Expose() thumbnailUrl: string;
}

export class AlbumItemDto {
  @ApiProperty() @Expose() id: string;
  @ApiProperty({ enum: ['IMAGE', 'VIDEO'] }) @Expose() resourceType: 'IMAGE' | 'VIDEO';
  @ApiProperty() @Expose() order: number;
  @ApiProperty() @Expose() @Type(() => Date) addedAt: Date;

  @ApiPropertyOptional({ type: AlbumItemImageDataDto })
  @Expose()
  @Type(() => AlbumItemImageDataDto)
  image?: AlbumItemImageDataDto;

  @ApiPropertyOptional({ type: AlbumItemVideoDataDto })
  @Expose()
  @Type(() => AlbumItemVideoDataDto)
  video?: AlbumItemVideoDataDto;
}

export class AlbumItemPaginationDto {
  @ApiProperty() @Expose() page: number;
  @ApiProperty() @Expose() perPage: number;
  @ApiProperty() @Expose() total: number;
  @ApiProperty() @Expose() totalPages: number;
}

export class AlbumItemListResponseDto {
  @ApiProperty({ type: [AlbumItemDto] })
  @Expose()
  @Type(() => AlbumItemDto)
  data: AlbumItemDto[];

  @ApiProperty({ type: AlbumItemPaginationDto })
  @Expose()
  @Type(() => AlbumItemPaginationDto)
  pagination: AlbumItemPaginationDto;
}
