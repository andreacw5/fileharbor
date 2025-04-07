import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class AvatarDto {
  @ApiPropertyOptional({ description: 'The unique identifier of the avatar' })
  @IsString()
  @IsOptional()
  id?: string;

  @ApiPropertyOptional({ description: 'Name of the file' })
  @IsString()
  filename: string;

  @ApiPropertyOptional({ description: 'Path to the file' })
  @IsString()
  path: string;

  @ApiPropertyOptional({ description: 'MIME type of the file' })
  @IsString()
  mimetype: string;

  @ApiPropertyOptional({ description: 'Size of the file in bytes' })
  @IsNumber()
  @IsOptional()
  size: number;

  @ApiPropertyOptional({ description: 'Number of views for the avatar', default: 0 })
  @IsNumber()
  @IsOptional()
  views?: number;

  @ApiProperty({ description: 'Description of the avatar' })
  @IsString()
  description: string;

  @ApiPropertyOptional({ description: 'Indicates if the avatar is optimized', default: false })
  @IsBoolean()
  @IsOptional()
  optimized?: boolean;

  @ApiPropertyOptional({ description: 'ID of the owner of the avatar' })
  @IsString()
  ownerId: string;
}
