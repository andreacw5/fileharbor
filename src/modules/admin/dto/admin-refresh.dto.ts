import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class AdminRefreshDto {
  @ApiProperty({ description: 'Refresh token obtained during login' })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

