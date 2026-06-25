import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class DeleteVideoResponseDto {
  @ApiProperty() @Expose() success: boolean;
  @ApiProperty() @Expose() message: string;
}
