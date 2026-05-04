import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

const trimOrUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export class UpdateUserByExternalIdDto {
  @ApiPropertyOptional({ description: 'Updated username from external system', maxLength: 100 })
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MaxLength(100)
  username?: string;

  @ApiPropertyOptional({ description: 'Updated email from external system' })
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsEmail()
  email?: string;
}

