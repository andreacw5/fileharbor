import { IsString, IsOptional, IsArray, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateImageMetadataDto {
  @ApiPropertyOptional({
    description: 'Image tags',
    type: [String],
    example: ['nature', 'landscape'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Image description',
    example: 'Beautiful sunset over the mountains',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description:
      'Make the image private or public. Bytes already served public may stay in browser and shared caches until they expire.',
  })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}
