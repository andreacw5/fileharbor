import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsNotIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class AdminCreateClientDto {
  @ApiProperty({ description: 'Client display name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    description:
      'Client domain (unique across clients). Set to null or an empty string for none.',
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === ''
      ? null
      : typeof value === 'string'
        ? value.toLowerCase()
        : value,
  )
  @IsString()
  @MaxLength(253)
  // The domain names the client's storage dir, next to dirs named by client id
  // and the shared defaults dir: a dotted hostname can be neither a UUID nor
  // anything with path characters.
  @Matches(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    { message: 'domain must be a lowercase hostname such as cdn.example.com' },
  )
  @IsNotIn(['defaults.fileharbor'], { message: 'domain is reserved' })
  domain?: string | null;

  @ApiPropertyOptional({
    description: 'Enable or disable the client',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description:
      'Bastion tenant slug mapped to this client for self-service (user-JWT) endpoints like /me/avatar. ' +
      'Set to null (or an empty string) to leave it unmapped.',
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
