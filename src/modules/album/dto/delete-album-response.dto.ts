import { ApiProperty } from '@nestjs/swagger';

export class DeleteAlbumResponseDto {
  @ApiProperty({
    description: 'Operation success status',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Response message',
    example: 'Album deleted successfully',
  })
  message: string;
}

