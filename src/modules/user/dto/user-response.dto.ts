import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';

export class UserClientDto {
  @ApiProperty() @Expose() id: string;
  @ApiProperty() @Expose() name: string;
  @ApiPropertyOptional() @Expose() domain?: string;
}

/** Full user response — includes bio. Use for single-user detail endpoints. */
export class UserResponseDto {
  @ApiProperty({ description: 'Internal user UUID' }) @Expose() id: string;
  @ApiProperty({ description: 'External user ID from the client system' }) @Expose() externalUserId: string;
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
  @ApiPropertyOptional({ description: 'Whether the requesting admin has bookmarked this user' }) @Expose() isBookmarked?: boolean;
  @ApiPropertyOptional() @Expose() avatarUrl?: string;

  @ApiPropertyOptional({ type: UserClientDto })
  @Expose()
  @Type(() => UserClientDto)
  client?: UserClientDto;
}

/**
 * Slim user response for list endpoints — bio intentionally omitted.
 * Use `UserResponseDto` for single-user detail endpoints that expose bio.
 */
export class UserListResponseDto {
  @ApiProperty({ description: 'Internal user UUID' }) @Expose() id: string;
  @ApiProperty({ description: 'External user ID from the client system' }) @Expose() externalUserId: string;
  @ApiPropertyOptional() @Expose() username?: string;
  @ApiPropertyOptional() @Expose() website?: string;
  @ApiProperty() @Expose() clientId: string;
  @ApiProperty() @Expose() @Type(() => Date) createdAt: Date;
  @ApiProperty() @Expose() @Type(() => Date) updatedAt: Date;
  @ApiPropertyOptional() @Expose() totalImages?: number;
  @ApiPropertyOptional() @Expose() totalAlbums?: number;
  @ApiPropertyOptional() @Expose() totalVideos?: number;
  @ApiPropertyOptional({ description: 'Whether the requesting admin has bookmarked this user' }) @Expose() isBookmarked?: boolean;
  @ApiPropertyOptional() @Expose() avatarUrl?: string;

  @ApiPropertyOptional({ type: UserClientDto })
  @Expose()
  @Type(() => UserClientDto)
  client?: UserClientDto;
}

