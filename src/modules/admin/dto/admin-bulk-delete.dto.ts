import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';

export const BULK_DELETE_MAX = 100;

export class AdminBulkDeleteDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    maxItems: BULK_DELETE_MAX,
    description: 'Ids of the images to delete',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_DELETE_MAX)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids: string[];
}
