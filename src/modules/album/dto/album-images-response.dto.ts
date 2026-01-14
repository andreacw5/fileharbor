import { ApiProperty } from '@nestjs/swagger';

export class AlbumImagesResponseDto {
  @ApiProperty({
    description: 'Operation success status',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Response message',
    example: 'Images added to album',
  })
  message?: string;

  @ApiProperty({
    description: 'Number of images affected',
    example: 5,
  })
  count?: number;

  @ApiProperty({
    description: 'Number of images added',
    example: 5,
  })
  added?: number;

  @ApiProperty({
    description: 'Number of images removed',
    example: 3,
  })
  removed?: number;
}

