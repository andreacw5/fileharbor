import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminUpdateImageDto {
  @ApiPropertyOptional({ description: 'Original filename' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  originalName?: string;

  @ApiPropertyOptional({ description: 'Make the image private or public' })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @ApiPropertyOptional({ description: 'Tags associated with the image', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Image description (set to null to remove)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;
}

