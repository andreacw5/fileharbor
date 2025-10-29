import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class DeleteResponseDto {
  @ApiProperty({
    description: 'Operation success status',
    example: true,
  })
  @Expose()
  success: boolean;

  @ApiProperty({
    description: 'Success message',
    example: 'Image deleted successfully',
  })
  @Expose()
  message: string;
}

