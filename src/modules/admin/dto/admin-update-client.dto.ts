import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';

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

  @ApiPropertyOptional({
    description: 'Enable or disable Tinify compression for this client',
  })
  @IsOptional()
  @IsBoolean()
  tinifyActive?: boolean;

  @ApiPropertyOptional({
    description: 'Tinify API key for this client (set to null to remove)',
  })
  @IsOptional()
  @IsString()
  tinifyApiKey?: string | null;

  @ApiPropertyOptional({
    description:
      'Manually set current Tinify usage counter (for admin reset purposes)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  currentTinifyUsage?: number;

  @ApiPropertyOptional({
    description:
      'Monthly Tinify compression limit (default: 500 for free tier)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  currentTinifyLimit?: number;

  @ApiPropertyOptional({
    description:
      'Auto-compress with Tinify the images above this size, in bytes (1048576 = 1 MB is a sensible start). ' +
      'null turns auto-compression off. Spends the same monthly quota as manual compression.',
    example: 1048576,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647) // INTEGER column
  tinifyAutoMinBytes?: number | null;

  @ApiPropertyOptional({
    description:
      'Bastion tenant slug mapped to this client for self-service (user-JWT) endpoints like /me/avatar. ' +
      'Set to null (or an empty string) to remove the mapping — a client without one never gets self-service avatars.',
    example: 'heyatom',
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,62}$/, {
    message:
      'bastionTenantSlug must be a lowercase slug (letters, digits and hyphens, starting with a letter or digit)',
  })
  bastionTenantSlug?: string | null;
}
