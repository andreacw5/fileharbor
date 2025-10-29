import { IsString, IsOptional, IsArray, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class UploadImageDto {
  @ApiPropertyOptional({
    description: 'External user ID',
    example: 'user-123'
  })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Album ID to add image to',
    example: 'abc-123-def-456'
  })
  @IsOptional()
  @IsString()
  albumId?: string;

  @ApiPropertyOptional({
    description: 'Image tags',
    type: [String],
    example: ['nature', 'landscape']
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.split(',').map(tag => tag.trim());
    }
    return value;
  })
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Image description',
    example: 'Beautiful sunset over the mountains'
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Mark image as private',
    default: false,
    example: false
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === '1' || value === true) return true;
    if (value === 'false' || value === '0' || value === false) return false;
    return false;
  })
  @IsBoolean()
  isPrivate?: boolean;
}

