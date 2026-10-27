import { IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PageParams } from '@heyatom/nest-common';

export class ListImagesDto extends PageParams {
  @ApiPropertyOptional({
    description: 'Filter by creator ID',
    example: 'creator-123',
  })
  @IsOptional()
  @IsString()
  creatorId?: string;

  @ApiPropertyOptional({
    description: 'Filter by album ID',
    example: 'album-456',
  })
  @IsOptional()
  @IsString()
  albumId?: string;
}
