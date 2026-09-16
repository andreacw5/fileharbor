import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CreateCreatorDto } from '@/modules/creator/dto/create-creator.dto';

export class CreateCreatorAdminDto extends CreateCreatorDto {
  @ApiProperty({
    description: 'Target client ID (UUID)',
    example: '00000000-0000-0000-0000-000000000000',
  })
  @IsUUID()
  clientId: string;
}
