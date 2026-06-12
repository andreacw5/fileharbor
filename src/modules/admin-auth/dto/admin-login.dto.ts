import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class AdminLoginDto {
  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'securePassword123' })
  @IsString()
  @MinLength(6)
  password: string;
}

export class AdminExchangeDto {
  @ApiProperty({ description: 'One-time OAuth code issued by Bastion after social login' })
  @IsString()
  code: string;
}

