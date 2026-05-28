import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CreateUserDto } from '@/modules/user/dto/create-user.dto';

export class CreateUserAdminDto extends CreateUserDto {
  @ApiProperty({ description: 'Target client ID (UUID)', example: '00000000-0000-0000-0000-000000000000' })
  @IsUUID()
  clientId: string;
}

