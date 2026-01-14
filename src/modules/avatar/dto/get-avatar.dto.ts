import { IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class GetAvatarDto {
  @ApiPropertyOptional({
    description: 'Return thumbnail version of the avatar',
    example: true,
    type: Boolean,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  thumb?: boolean;

  @ApiPropertyOptional({
    description: 'Return only metadata (JSON) instead of the file',
    example: false,
    type: Boolean,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  info?: boolean;

  @ApiPropertyOptional({
    description: 'Force file download with Content-Disposition header',
    example: false,
    type: Boolean,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  download?: boolean;
}

