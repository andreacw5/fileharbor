import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAlbumDto {
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

