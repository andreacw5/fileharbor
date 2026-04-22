import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsOptional, IsEnum, IsBoolean, IsArray, IsUUID } from 'class-validator';

export enum AdminRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  VIEWER = 'VIEWER',
}

export class CreateAdminUserDto {
  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'securePassword123' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: AdminRole, default: AdminRole.VIEWER })
  @IsOptional()
  @IsEnum(AdminRole)
  role?: AdminRole;

  @ApiPropertyOptional({
    description: 'If true, grants access to all clients. SUPER_ADMIN defaults to true.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  allClientsAccess?: boolean;

  @ApiPropertyOptional({
    description: 'Client IDs this admin can access (when allClientsAccess is false)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  clientIds?: string[];
}
