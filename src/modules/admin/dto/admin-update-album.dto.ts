import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

export class AdminUpdateAlbumDto {
  @ApiPropertyOptional({ description: 'Album name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'Album description' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: 'Make the album public or private' })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({ description: 'External album ID from the client\'s system (set to null to remove)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalAlbumId?: string | null;

  @ApiPropertyOptional({ description: 'Cover image ID (set to null to remove)', nullable: true })
  @IsOptional()
  @ValidateIf((o) => o.coverImageId !== null)
  @IsUUID()
  coverImageId?: string | null;
}

