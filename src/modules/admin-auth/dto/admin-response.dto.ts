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

