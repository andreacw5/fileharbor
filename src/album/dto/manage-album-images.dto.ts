import { IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ManageAlbumImagesDto {
  @ApiProperty({
    description: 'Array of image IDs to add or remove from the album',
    type: [String],
    example: ['b2ce77c1-3836-4e28-807f-51f929e12423', 'c3df88d2-4947-5f39-918e-62ga30f23534'],
  })
  @IsArray()
  @IsString({ each: true })
  imageIds: string[];
}

