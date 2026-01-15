import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAlbumDto {
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
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

