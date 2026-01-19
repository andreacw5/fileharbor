import { IsString, IsOptional, IsNumber, Min, Max, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

export class GetImageDto {
  @ApiPropertyOptional({
    description: 'Return pre-generated thumbnail instead of full image',
    example: false,
    type: Boolean
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === '1' || value === true) return true;
    if (value === 'false' || value === '0' || value === false) return false;
    return value;
  })
  @IsBoolean()
  thumb?: boolean;

  @ApiPropertyOptional({
    description: 'Force download with Content-Disposition header and increment download counter',
    example: false,
    type: Boolean
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === '1' || value === true) return true;
    if (value === 'false' || value === '0' || value === false) return false;
    return value;
  })
  @IsBoolean()
  download?: boolean;

  @ApiPropertyOptional({
    description: 'Return JSON metadata instead of image file',
    example: false,
    type: Boolean
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === '1' || value === true) return true;
    if (value === 'false' || value === '0' || value === false) return false;
    return value;
  })
  @IsBoolean()
  info?: boolean;

  @ApiPropertyOptional({
    description: 'Target width in pixels (maintains aspect ratio if height not specified)',
    example: 800,
    minimum: 1
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  width?: number;

  @ApiPropertyOptional({
    description: 'Target height in pixels (maintains aspect ratio if width not specified)',
    example: 600,
    minimum: 1
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  height?: number;

  @ApiPropertyOptional({
    description: 'Output format',
    enum: ['webp', 'jpeg', 'png'],
    example: 'webp'
  })
  @IsOptional()
  @IsString()
  format?: 'webp' | 'jpeg' | 'png';

  @ApiPropertyOptional({
    description: 'Image quality (1-100)',
    minimum: 1,
    maximum: 100,
    example: 85
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  quality?: number;

  @ApiPropertyOptional({
    description: 'Share token for accessing private images or read token for public share links',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  })
  @IsOptional()
  @IsString()
  token?: string;

  @ApiPropertyOptional({
    description: 'Timestamp for cache busting (ignored by server, used by browser to force reload)',
    example: '1768848792396',
    type: String,
  })
  @IsOptional()
  @IsString()
  t?: string;
}

