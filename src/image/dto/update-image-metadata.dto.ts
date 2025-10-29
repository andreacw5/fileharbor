import { IsString, IsOptional, IsArray } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateImageMetadataDto {
  @ApiPropertyOptional({
    description: 'Image tags',
    type: [String],
    example: ['nature', 'landscape']
  })
  @IsOptional()
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
}

