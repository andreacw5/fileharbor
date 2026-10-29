import {
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  ValidateIf,
} from 'class-validator';
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
  // Not @IsOptional: that lets null through to Prisma (non-nullable column → 500).
  @ValidateIf((o) => o.isPrivate !== undefined)
  @IsBoolean()
  isPrivate?: boolean;

  @ApiPropertyOptional({
    description:
      'Serve the ?blur=1 preview to anyone, even when the image is private. The original keeps its own access.',
  })
  @ValidateIf((o) => o.blurPublic !== undefined)
  @IsBoolean()
  blurPublic?: boolean;
}
