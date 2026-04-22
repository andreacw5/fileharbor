import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsArray, IsUUID } from 'class-validator';

export class SetAdminClientAccessDto {
  @ApiPropertyOptional({
    description: 'If true, the admin user has access to ALL clients (overrides clientIds)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  allClientsAccess?: boolean;

  @ApiPropertyOptional({
    description: 'List of client IDs to grant access to (used when allClientsAccess is false)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  clientIds?: string[];
}

