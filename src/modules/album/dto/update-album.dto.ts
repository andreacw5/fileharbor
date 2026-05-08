import { IsString, IsOptional, IsBoolean, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAlbumDto {
  @ApiPropertyOptional({
    description: 'External album ID from the client application',
    example: 'ext-album-123',
  })
  @IsOptional()
  @IsString()
  externalAlbumId?: string;

  @ApiPropertyOptional({
    description: 'Album name',
    example: 'Updated Vacation Photos',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Album description',
    example: 'Updated description with more details',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Whether the album is public',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({
    description: 'Cover image ID (must be an image already in the album). Set to null to remove.',
    example: 'image-uuid-123',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  coverImageId?: string | null;
}

