import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';

export class AdminUserResponseDto {
  @ApiProperty() @Expose() id: string;
  @ApiProperty() @Expose() email: string;
  @ApiPropertyOptional() @Expose() name?: string;
  @ApiProperty() @Expose() role: string;
  @ApiProperty() @Expose() active: boolean;
  @ApiProperty({ description: 'If true, has access to all clients' }) @Expose() allClientsAccess: boolean;
  @ApiPropertyOptional({ description: 'IDs of allowed clients (when allClientsAccess is false)', type: [String] })
  @Expose() allowedClientIds?: string[];
  @ApiPropertyOptional() @Expose() lastLoginAt?: Date;
  @ApiProperty() @Expose() @Type(() => Date) createdAt: Date;
}

export class AdminLoginResponseDto {
  @ApiProperty({ description: 'Short-lived JWT access token' })
  @Expose()
  accessToken: string;

  @ApiProperty({ description: 'Long-lived opaque refresh token' })
  @Expose()
  refreshToken: string;

  @ApiProperty({ description: 'Access token expiry in seconds' })
  @Expose()
  expiresIn: number;

  @ApiProperty()
  @Expose()
  user: AdminUserResponseDto;
}

export class AdminRefreshResponseDto {
  @ApiProperty({ description: 'New short-lived JWT access token' })
  @Expose()
  accessToken: string;

  @ApiProperty({ description: 'New refresh token (old one is revoked)' })
  @Expose()
  refreshToken: string;

  @ApiProperty({ description: 'Access token expiry in seconds' })
  @Expose()
  expiresIn: number;
}

export class AdminClientResponseDto {
  @ApiProperty() @Expose() id: string;
  @ApiProperty() @Expose() name: string;
  @ApiPropertyOptional() @Expose() domain?: string;
  @ApiProperty() @Expose() active: boolean;
  @ApiProperty() @Expose() webhookEnabled: boolean;
  @ApiPropertyOptional() @Expose() webhookUrl?: string;
  @ApiProperty() @Expose() @Type(() => Date) createdAt: Date;
  @ApiProperty() @Expose() @Type(() => Date) updatedAt: Date;
  @ApiPropertyOptional() @Expose() totalImages?: number;
  @ApiPropertyOptional() @Expose() totalAvatars?: number;
  @ApiPropertyOptional() @Expose() totalAlbums?: number;
  @ApiPropertyOptional() @Expose() totalStorage?: number;
}

export class DailyDataPointDto {
  @ApiProperty({ description: 'Date in YYYY-MM-DD format' }) @Expose() date: string;
  @ApiProperty() @Expose() images: number;
  @ApiProperty() @Expose() avatars: number;
  @ApiProperty() @Expose() albums: number;
}

export class StatsTrendDto {
  @ApiProperty({ description: 'New items in the last 7 days' }) @Expose() newImages: number;
  @ApiProperty({ description: 'New items in the last 7 days' }) @Expose() newAvatars: number;
  @ApiProperty({ description: 'New items in the last 7 days' }) @Expose() newAlbums: number;
  @ApiProperty({ description: 'New items in the last 7 days' }) @Expose() newUsers: number;
  @ApiProperty({ description: 'Storage added in the last 7 days (bytes)' }) @Expose() newStorage: number;
}

export class AdminStatsResponseDto {
  @ApiProperty() @Expose() totalClients: number;
  @ApiProperty() @Expose() totalImages: number;
  @ApiProperty() @Expose() totalAvatars: number;
  @ApiProperty() @Expose() totalAlbums: number;
  @ApiProperty() @Expose() totalStorage: number;
  @ApiProperty() @Expose() totalUsers: number;

  @ApiProperty({ description: 'New counts in the last 7 days', type: StatsTrendDto })
  @Expose()
  @Type(() => StatsTrendDto)
  last7Days: StatsTrendDto;

  @ApiProperty({ description: 'Daily breakdown for the last 7 days (for charts)', type: [DailyDataPointDto] })
  @Expose()
  @Type(() => DailyDataPointDto)
  dailyChart: DailyDataPointDto[];
}

export class AdminAlbumUserDto {
  @ApiProperty() @Expose() externalUserId: string;
  @ApiPropertyOptional() @Expose() username?: string;
}

export class AdminAlbumResponseDto {
  @ApiProperty() @Expose() id: string;
  @ApiProperty() @Expose() clientId: string;
  @ApiProperty() @Expose() name: string;
  @ApiPropertyOptional() @Expose() description?: string;
  @ApiPropertyOptional() @Expose() externalAlbumId?: string;
  @ApiProperty() @Expose() isPublic: boolean;
  @ApiProperty() @Expose() @Type(() => Date) createdAt: Date;
  @ApiProperty() @Expose() @Type(() => Date) updatedAt: Date;

  @ApiPropertyOptional({ type: AdminAlbumUserDto })
  @Expose()
  @Type(() => AdminAlbumUserDto)
  user?: AdminAlbumUserDto;

  @ApiPropertyOptional() @Expose() totalImages?: number;
  @ApiPropertyOptional({ description: 'Number of active (non-expired) access tokens' })
  @Expose() activeTokens?: number;
}

export class AdminDeleteResponseDto {
  @ApiProperty() @Expose() success: boolean;
  @ApiProperty() @Expose() message: string;
}

export class AdminImageUserDto {
  @ApiProperty() @Expose() externalUserId: string;
  @ApiPropertyOptional() @Expose() username?: string;
}

export class AdminImageAlbumDto {
  @ApiProperty() @Expose() id: string;
  @ApiProperty() @Expose() name: string;
  @ApiPropertyOptional() @Expose() externalAlbumId?: string;
  @ApiProperty() @Expose() isPublic: boolean;
}

export class AdminImageResponseDto {
  @ApiProperty() @Expose() id: string;
  @ApiProperty() @Expose() clientId: string;
  @ApiProperty() @Expose() originalName: string;
  @ApiProperty() @Expose() format: string;
  @ApiProperty() @Expose() width: number;
  @ApiProperty() @Expose() height: number;
  @ApiProperty() @Expose() size: number;
  @ApiProperty() @Expose() mimeType: string;
  @ApiProperty() @Expose() isPrivate: boolean;
  @ApiProperty() @Expose() isOptimized: boolean;
  @ApiProperty({ type: [String] }) @Expose() tags: string[];
  @ApiPropertyOptional() @Expose() description?: string;
  @ApiProperty() @Expose() views: number;
  @ApiProperty() @Expose() downloads: number;
  @ApiProperty() @Expose() storagePath: string;
  @ApiProperty() @Expose() @Type(() => Date) createdAt: Date;
  @ApiProperty() @Expose() @Type(() => Date) updatedAt: Date;
  @ApiPropertyOptional() @Expose() @Type(() => Date) optimizedAt?: Date;

  @ApiPropertyOptional() @Expose() fullPath?: string;

  @ApiPropertyOptional({ type: AdminImageUserDto })
  @Expose()
  @Type(() => AdminImageUserDto)
  user?: AdminImageUserDto;

  @ApiPropertyOptional({ description: 'Albums this image belongs to', type: [AdminImageAlbumDto] })
  @Expose()
  @Type(() => AdminImageAlbumDto)
  albums?: AdminImageAlbumDto[];

  @ApiPropertyOptional({ description: 'Number of active (non-expired) share links for this image' })
  @Expose()
  activeShareLinks?: number;
}

export class AdminAvatarResponseDto {
  @ApiProperty() @Expose() id: string;
  @ApiProperty() @Expose() clientId: string;
  @ApiProperty() @Expose() userId: string;
  @ApiProperty() @Expose() format: string;
  @ApiProperty() @Expose() width: number;
  @ApiProperty() @Expose() height: number;
  @ApiProperty() @Expose() size: number;
  @ApiProperty() @Expose() mimeType: string;
  @ApiProperty() @Expose() isOptimized: boolean;
  @ApiProperty() @Expose() storagePath: string;
  @ApiProperty() @Expose() @Type(() => Date) createdAt: Date;
  @ApiProperty() @Expose() @Type(() => Date) updatedAt: Date;
  @ApiPropertyOptional() @Expose() @Type(() => Date) optimizedAt?: Date;

  @ApiPropertyOptional() @Expose() fullPath?: string;

  @ApiPropertyOptional({ type: AdminImageUserDto })
  @Expose()
  @Type(() => AdminImageUserDto)
  user?: AdminImageUserDto;
}

export class AdminClientUserClientDto {
  @ApiProperty() @Expose() id: string;
  @ApiProperty() @Expose() name: string;
  @ApiPropertyOptional() @Expose() domain?: string;
}

export class AdminClientUserResponseDto {
  @ApiProperty({ description: 'Internal user UUID' }) @Expose() id: string;
  @ApiProperty({ description: 'External user ID from the client system' }) @Expose() externalUserId: string;
  @ApiPropertyOptional() @Expose() username?: string;
  @ApiProperty() @Expose() clientId: string;
  @ApiProperty() @Expose() @Type(() => Date) createdAt: Date;
  @ApiProperty() @Expose() @Type(() => Date) updatedAt: Date;
  @ApiPropertyOptional() @Expose() totalImages?: number;
  @ApiPropertyOptional() @Expose() totalAvatars?: number;
  @ApiPropertyOptional() @Expose() totalAlbums?: number;

  @ApiPropertyOptional({ type: AdminClientUserClientDto })
  @Expose()
  @Type(() => AdminClientUserClientDto)
  client?: AdminClientUserClientDto;
}

export class AdminTagsResponseDto {
  @ApiProperty({ description: 'List of distinct tags used across images', type: [String] })
  @Expose()
  tags: string[];

  @ApiProperty({ description: 'Total number of distinct tags returned' })
  @Expose()
  total: number;
}

export class AdminAlbumImageEntryDto {
  @ApiProperty() @Expose() imageId: string;
  @ApiProperty() @Expose() order: number;
}

export class AdminAddImagesToAlbumResponseDto {
  @ApiProperty({ description: 'UUID of the album' }) @Expose() albumId: string;
  @ApiProperty({ description: 'Images added with their order', type: [AdminAlbumImageEntryDto] })
  @Expose()
  @Type(() => AdminAlbumImageEntryDto)
  images: AdminAlbumImageEntryDto[];
  @ApiProperty({ description: 'Number of images processed' }) @Expose() count: number;
}


