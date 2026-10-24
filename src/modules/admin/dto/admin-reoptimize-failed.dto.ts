import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class AdminReoptimizeFailedDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Limit to one client; omitted = every client you can see',
  })
  @IsOptional()
  @IsUUID()
  clientId?: string;
}
