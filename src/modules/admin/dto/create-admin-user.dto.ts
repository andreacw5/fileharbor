import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUUID, IsOptional, IsBoolean, IsArray } from 'class-validator';

export class CreateAdminUserDto {
  @ApiProperty({ description: 'Bastion user UUID (sub from JWT)', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  bastionUserId: string;

  @ApiProperty({ example: 'admin@example.com' })
  @IsString()
  email: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'If true, grants access to all clients', default: false })
  @IsOptional()
  @IsBoolean()
  allClientsAccess?: boolean;

  @ApiPropertyOptional({ description: 'Client IDs this admin can access (when allClientsAccess is false)', type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  clientIds?: string[];
}
