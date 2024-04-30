import { ApiProperty } from '@nestjs/swagger';

export class LocalFileFilterDto {
  @ApiProperty({
    description: 'Type of file',
    enum: ['local', 'avatar'],
    required: false,
  })
  type?: string;
  @ApiProperty({
    description: 'Tags of the file',
    required: false,
  })
  tags?: string[];
  @ApiProperty({
    description: 'Description of the file',
    required: false,
  })
  description?: string;
  @ApiProperty({
    description: 'Filename of the file',
    required: false,
  })
  filename?: string;
}
