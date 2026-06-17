import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class AdminLoginDto {
  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'securePassword123' })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiPropertyOptional({ example: 'dbd', description: 'Required when fileharbor app is registered in multiple tenants' })
  @IsOptional()
  @IsString()
  tenantSlug?: string;
}

export class AdminExchangeDto {
  @ApiProperty({ description: 'One-time OAuth code issued by Bastion after social login' })
  @IsString()
  code: string;
}

