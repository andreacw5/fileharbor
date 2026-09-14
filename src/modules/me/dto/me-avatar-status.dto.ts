import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { AvatarResponseDto } from '@/modules/avatar/dto';

export class MeAvatarStatusDto {
  @ApiProperty({
    description:
      'Whether the caller\'s Bastion tenant has a FileHarbor client mapped for self-service avatars ' +
      '(Client.bastionTenantSlug). False means uploading/deleting an avatar is not possible for this tenant.',
  })
  @Expose()
  enabled: boolean;

  @ApiPropertyOptional({
    type: AvatarResponseDto,
    nullable: true,
    description: 'The current avatar, or null if the user has not uploaded one yet.',
  })
  @Expose()
  @Type(() => AvatarResponseDto)
  avatar: AvatarResponseDto | null;
}
