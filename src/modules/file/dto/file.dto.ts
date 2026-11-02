import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform, Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { PageParams } from '@heyatom/nest-common';

export class UploadFileDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  isPrivate?: boolean;
}

export class ListFilesDto extends PageParams {
  @ApiPropertyOptional({ description: "Creator's externalId (X-User-Id)" })
  @IsOptional()
  @IsString()
  creatorId?: string;
}

export class FileCreatorDto {
  @ApiProperty() @Expose() externalId: string;
}

export class FileResponseDto {
  @ApiProperty() @Expose() id: string;
  @ApiProperty() @Expose() clientId: string;
  @ApiProperty() @Expose() originalName: string;
  @ApiProperty({ enum: ['application/zip', 'application/pdf'] })
  @Expose()
  mimeType: string;
  // BigInt in the DB: JSON.stringify throws on a bigint (exact up to 8 PiB)
  @ApiProperty({ description: 'Bytes' })
  @Expose()
  @Transform(({ value }) => (typeof value === 'bigint' ? Number(value) : value))
  size: number;
  @ApiProperty() @Expose() isPrivate: boolean;
  @ApiProperty() @Expose() downloads: number;
  @ApiProperty() @Expose() @Type(() => Date) createdAt: Date;
  @ApiProperty({ type: FileCreatorDto })
  @Expose()
  @Type(() => FileCreatorDto)
  creator: FileCreatorDto;
  @ApiProperty({
    description:
      'Absolute download URL. A private file also needs the X-API-Key of its client, or a signed link (POST /files/:id/link).',
  })
  @Expose()
  downloadUrl: string;
}

export class FileLinkResponseDto {
  @ApiProperty({ description: 'Download URL with a ?token valid 10 minutes' })
  url: string;
  @ApiProperty() expiresAt: Date;
}
