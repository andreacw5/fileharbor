import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PageParams } from '@heyatom/nest-common';

export class ListCreatorsDto extends PageParams {
  @ApiPropertyOptional({ description: 'Search by externalId or username' })
  @IsOptional()
  @IsString()
  search?: string;
}
