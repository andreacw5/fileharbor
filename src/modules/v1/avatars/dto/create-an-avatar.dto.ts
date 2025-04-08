import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CreateAnAvatarDto {
  @ApiPropertyOptional({
    description: 'Caller app ID of the owner of the avatar',
  })
  @IsString()
  externalId?: string;

  @ApiPropertyOptional({ description: 'OwnerId of the avatar' })
  @IsString()
  ownerId?: string;

  @ApiPropertyOptional({ description: 'Domain of the avatar' })
  @IsString()
  domain?: string;

  @ApiPropertyOptional({ description: 'Description of the avatar' })
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Path to the file' })
  @IsString()
  path: string;
}
