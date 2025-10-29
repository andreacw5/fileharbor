import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class DeleteAvatarResponseDto {
  @ApiProperty({
    description: 'Operation success status',
    example: true,
  })
  @Expose()
  success: boolean;

  @ApiProperty({
    description: 'Success message',
    example: 'Avatar deleted successfully',
  })
  @Expose()
  message: string;
}

