import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength, IsInt, Min } from 'class-validator';

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

  @ApiPropertyOptional({ description: 'Enable or disable Tinify compression for this client' })
  @IsOptional()
  @IsBoolean()
  tinifyActive?: boolean;

  @ApiPropertyOptional({ description: 'Tinify API key for this client (set to null to remove)' })
  @IsOptional()
  @IsString()
  tinifyApiKey?: string | null;

  @ApiPropertyOptional({ description: 'Manually set current Tinify usage counter (for admin reset purposes)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  currentTinifyUsage?: number;

  @ApiPropertyOptional({ description: 'Monthly Tinify compression limit (default: 500 for free tier)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  currentTinifyLimit?: number;
}

