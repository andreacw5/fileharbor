import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { PageParams } from '@heyatom/nest-common';

export class ListAlbumsDto extends PageParams {
  @ApiPropertyOptional({
    description:
      'Filter by the internal Creator.id (the `creatorId` returned in album and image responses), not the X-User-Id',
    example: 'creator-123',
  })
  @IsOptional()
  @IsString()
  creatorId?: string;

  @ApiPropertyOptional({
    description: 'Filter by public status (true/false)',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
  })
  @IsBoolean()
  public?: boolean;

  @ApiPropertyOptional({
    description: 'Search albums by name',
    example: 'vacation',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
