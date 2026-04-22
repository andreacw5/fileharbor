import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsArray, IsUUID } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class AdminUploadImageDto {
  @ApiProperty({ description: 'Target client ID for the upload' })
  @IsString()
  @IsUUID()
  clientId: string;

  @ApiPropertyOptional({ description: 'External user ID (from client system). Defaults to "system" if omitted.' })
  @IsOptional()
  @IsString()
  externalUserId?: string;

  @ApiPropertyOptional({ description: 'Album ID to add the image to' })
  @IsOptional()
  @IsString()
  albumId?: string;

  @ApiPropertyOptional({ description: 'Tags for the image', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.split(',').map((t) => t.trim()).filter(Boolean);
    return value;
  })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Image description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Mark image as private', default: false })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isPrivate?: boolean;
}

