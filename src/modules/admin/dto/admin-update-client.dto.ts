import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class AdminUpdateClientDto {
  @ApiPropertyOptional({ description: 'Client display name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'Enable or disable the client' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'Enable or disable webhook notifications' })
  @IsOptional()
  @IsBoolean()
  webhookEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Discord webhook URL (set to null to remove)' })
  @IsOptional()
  @IsUrl()
  webhookUrl?: string | null;
}

