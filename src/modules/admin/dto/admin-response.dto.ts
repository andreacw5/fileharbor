import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type, Transform } from 'class-transformer';
import { maskApiKey } from '../helpers/mask-api-key.helper';


export class AdminClientResponseDto {
  @ApiProperty() @Expose() id: string;
  @ApiProperty() @Expose() name: string;
  @ApiPropertyOptional() @Expose() domain?: string;
  @ApiProperty() @Expose() active: boolean;
  @ApiProperty() @Expose() webhookEnabled: boolean;
  @ApiPropertyOptional() @Expose() webhookUrl?: string;
  @ApiProperty({ description: 'Whether Tinify compression is enabled for this client' })
  @Expose() tinifyActive: boolean;
  @ApiPropertyOptional({ description: 'Tinify API key for this client (masked for security)', example: 'sk_1234****abcd' })
  @Expose()
  @Transform(({ value }) => maskApiKey(value))
  tinifyApiKey?: string;
  @ApiProperty({ description: 'Current monthly Tinify compression usage' })
  @Expose() currentTinifyUsage: number;
  @ApiProperty({ description: 'Monthly Tinify compression limit (default: 500 for free tier)', default: 500 })
  @Expose() currentTinifyLimit: number;
  @ApiProperty() @Expose() @Type(() => Date) createdAt: Date;
  @ApiProperty() @Expose() @Type(() => Date) updatedAt: Date;
  @ApiPropertyOptional() @Expose() totalImages?: number;
  @ApiPropertyOptional() @Expose() totalAvatars?: number;
  @ApiPropertyOptional() @Expose() totalAlbums?: number;
  @ApiPropertyOptional() @Expose() totalUsers?: number;
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

export class AdminClientUserClientDto {
  @ApiProperty() @Expose() id: string;
  @ApiProperty() @Expose() name: string;
  @ApiPropertyOptional() @Expose() domain?: string;
}

export class AdminAlbumResponseDto {
  @ApiProperty() @Expose() id: string;
  @ApiProperty() @Expose() clientId: string;
  @ApiProperty() @Expose() name: string;
  @ApiPropertyOptional() @Expose() description?: string;
  @ApiPropertyOptional() @Expose() externalAlbumId?: string;
  @ApiProperty() @Expose() isPublic: boolean;
  @ApiPropertyOptional() @Expose() coverImageId?: string;
  @ApiPropertyOptional({ description: 'Full URL to the cover image' }) @Expose() coverImageUrl?: string;
  @ApiProperty() @Expose() @Type(() => Date) createdAt: Date;
  @ApiProperty() @Expose() @Type(() => Date) updatedAt: Date;

  @ApiPropertyOptional({ type: AdminClientUserClientDto })
  @Expose()
  @Type(() => AdminClientUserClientDto)
  client?: AdminClientUserClientDto;

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
  @ApiProperty({ description: 'Whether image was compressed with Tinify API' })
  @Expose() tinifyOptimized: boolean;
  @ApiProperty({ type: [String] }) @Expose() tags: string[];
  @ApiPropertyOptional() @Expose() description?: string;
  @ApiProperty() @Expose() views: number;
  @ApiProperty() @Expose() downloads: number;
  @ApiProperty() @Expose() storagePath: string;
  @ApiProperty() @Expose() @Type(() => Date) createdAt: Date;
  @ApiProperty() @Expose() @Type(() => Date) updatedAt: Date;
  @ApiPropertyOptional() @Expose() @Type(() => Date) optimizedAt?: Date;

  @ApiPropertyOptional() @Expose() fullPath?: string;

  @ApiPropertyOptional({ type: AdminClientUserClientDto })
  @Expose()
  @Type(() => AdminClientUserClientDto)
  client?: AdminClientUserClientDto;

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

  @ApiPropertyOptional({ type: AdminClientUserClientDto })
  @Expose()
  @Type(() => AdminClientUserClientDto)
  client?: AdminClientUserClientDto;

  @ApiPropertyOptional({ type: AdminImageUserDto })
  @Expose()
  @Type(() => AdminImageUserDto)
  user?: AdminImageUserDto;
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

export class AdminRemoveImagesFromAlbumResponseDto {
  @ApiProperty({ description: 'UUID of the album' }) @Expose() albumId: string;
  @ApiProperty({ description: 'Number of images removed' }) @Expose() removed: number;
  @ApiProperty() @Expose() success: boolean;
  @ApiProperty() @Expose() message: string;
}


