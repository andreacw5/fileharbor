import { IsString, IsOptional, IsBoolean } from 'class-validator';
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
}

