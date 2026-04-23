import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';

export class UserClientDto {
  @ApiProperty() @Expose() id: string;
  @ApiProperty() @Expose() name: string;
  @ApiPropertyOptional() @Expose() domain?: string;
}

export class UserResponseDto {
  @ApiProperty({ description: 'Internal user UUID' }) @Expose() id: string;
  @ApiProperty({ description: 'External user ID from the client system' }) @Expose() externalUserId: string;
  @ApiPropertyOptional() @Expose() username?: string;
  @ApiProperty() @Expose() clientId: string;
  @ApiProperty() @Expose() @Type(() => Date) createdAt: Date;
  @ApiProperty() @Expose() @Type(() => Date) updatedAt: Date;
  @ApiPropertyOptional() @Expose() totalImages?: number;
  @ApiPropertyOptional() @Expose() totalAvatars?: number;
  @ApiPropertyOptional() @Expose() totalAlbums?: number;

  @ApiPropertyOptional({ type: UserClientDto })
  @Expose()
  @Type(() => UserClientDto)
  client?: UserClientDto;
}

