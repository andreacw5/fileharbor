import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform, Type } from 'class-transformer';

export class VideoResponseDto {
  @ApiProperty() @Expose() id: string;
  @ApiProperty() @Expose() clientId: string;
  @ApiProperty() @Expose() user: object;
  @ApiProperty() @Expose() client: object;
  @ApiProperty() @Expose() originalName: string;
  @ApiProperty() @Expose() mimeType: string;
  @ApiProperty() @Expose() size: number;
  @ApiPropertyOptional() @Expose() duration?: number;
  @ApiPropertyOptional() @Expose() width?: number;
  @ApiPropertyOptional() @Expose() height?: number;

  @ApiProperty()
  @Expose()
  @Transform(({ value }) => value || false)
  isPrivate: boolean;

  @ApiProperty()
  @Expose()
  @Transform(({ value }) => value || 0)
  views: number;

  @ApiProperty()
  @Expose()
  @Transform(({ value }) => value || 0)
  downloads: number;

  @ApiPropertyOptional() @Expose() description?: string;

  @ApiProperty({ type: [String] })
  @Expose()
  @Transform(({ value }) => value || [])
  tags: string[];

  @ApiProperty() @Expose() @Type(() => Date) createdAt: Date;
  @ApiProperty({ description: 'Full absolute stream URL' }) @Expose() fullPath: string;
  @ApiProperty({ description: 'Full absolute thumbnail URL' }) @Expose() fullThumbnailUrl: string;
}
