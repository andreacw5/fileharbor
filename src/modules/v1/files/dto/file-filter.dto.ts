import { ApiProperty } from '@nestjs/swagger';

export class FilesFilterDto {
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
    description: 'Domain of the file',
    required: false,
  })
  domain?: string;
  @ApiProperty({
    description: 'Filename of the file',
    required: false,
  })
  filename?: string;
}
