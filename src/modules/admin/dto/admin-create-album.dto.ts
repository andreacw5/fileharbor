import { IsString, IsOptional, IsBoolean, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class AdminCreateAlbumDto {
  @ApiProperty({
    description: 'ID of the client that will own the album',
    format: 'uuid',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsUUID()
  clientId: string;

  @ApiPropertyOptional({
    description: 'External user ID to associate the album with (defaults to "system")',
    example: 'user-456',
  })
  @IsOptional()
  @IsString()
  externalUserId?: string;

  @ApiProperty({
    description: 'Album name',
    example: 'Vacation Photos 2025',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Album description',
    example: 'Photos from our summer vacation in Italy',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Whether the album is public (accessible without authentication)',
    default: false,
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  isPublic?: boolean;

  @ApiPropertyOptional({
    description: 'External album ID from the client application',
    example: 'ext-album-123',
  })
  @IsOptional()
  @IsString()
  externalAlbumId?: string;

  @ApiPropertyOptional({
    description: 'Cover image ID (must be an image that belongs to the album)',
    format: 'uuid',
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  })
  @IsOptional()
  @IsUUID()
  coverImageId?: string;
}

