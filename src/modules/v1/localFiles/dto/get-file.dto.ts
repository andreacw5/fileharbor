import { ApiProperty } from '@nestjs/swagger';

export class GetLocalFileDto {
  @ApiProperty({
    description: 'Security token for the file',
    required: false,
  })
  token?: string;
}
