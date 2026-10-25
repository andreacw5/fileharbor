import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PageParams } from '@heyatom/nest-common';

export class ListVideosDto extends PageParams {
  @ApiPropertyOptional() @IsOptional() @IsString() creatorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() tag?: string;
}
