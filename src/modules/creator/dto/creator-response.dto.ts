import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';

export class CreatorClientDto {
  @ApiProperty() @Expose() id: string;
  @ApiProperty() @Expose() name: string;
  @ApiPropertyOptional() @Expose() domain?: string;
}

/** Full creator response — includes bio. Use for single-creator detail endpoints. */
export class CreatorResponseDto {
  @ApiProperty({ description: 'Internal creator UUID' }) @Expose() id: string;
  @ApiProperty({ description: 'External creator ID from the client system' })
  @Expose()
  externalId: string;
  @ApiPropertyOptional() @Expose() username?: string;
  @ApiPropertyOptional() @Expose() website?: string;
  @ApiPropertyOptional() @Expose() bio?: string;
  @ApiProperty() @Expose() clientId: string;
  @ApiProperty() @Expose() @Type(() => Date) createdAt: Date;
  @ApiProperty() @Expose() @Type(() => Date) updatedAt: Date;
  @ApiPropertyOptional() @Expose() totalImages?: number;
  @ApiPropertyOptional() @Expose() totalAvatars?: number;
  @ApiPropertyOptional() @Expose() totalAlbums?: number;
  @ApiPropertyOptional() @Expose() totalVideos?: number;
  @ApiPropertyOptional({
    description: 'Whether the requesting admin has bookmarked this creator',
  })
  @Expose()
  isBookmarked?: boolean;
  @ApiPropertyOptional() @Expose() avatarUrl?: string;

  @ApiPropertyOptional({ type: CreatorClientDto })
  @Expose()
  @Type(() => CreatorClientDto)
  client?: CreatorClientDto;
}

/**
 * Slim creator response for list endpoints — bio intentionally omitted.
 * Use `CreatorResponseDto` for single-creator detail endpoints that expose bio.
 */
export class CreatorListResponseDto {
  @ApiProperty({ description: 'Internal creator UUID' }) @Expose() id: string;
  @ApiProperty({ description: 'External creator ID from the client system' })
  @Expose()
  externalId: string;
  @ApiPropertyOptional() @Expose() username?: string;
  @ApiPropertyOptional() @Expose() website?: string;
  @ApiProperty() @Expose() clientId: string;
  @ApiProperty() @Expose() @Type(() => Date) createdAt: Date;
  @ApiProperty() @Expose() @Type(() => Date) updatedAt: Date;
  @ApiPropertyOptional() @Expose() totalImages?: number;
  @ApiPropertyOptional() @Expose() totalAlbums?: number;
  @ApiPropertyOptional() @Expose() totalVideos?: number;
  @ApiPropertyOptional({
    description: 'Whether the requesting admin has bookmarked this creator',
  })
  @Expose()
  isBookmarked?: boolean;
  @ApiPropertyOptional() @Expose() avatarUrl?: string;

  @ApiPropertyOptional({ type: CreatorClientDto })
  @Expose()
  @Type(() => CreatorClientDto)
  client?: CreatorClientDto;
}
