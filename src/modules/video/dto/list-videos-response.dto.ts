import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { VideoResponseDto } from './video-response.dto';
import { VideoPaginationMetaDto } from './pagination-meta.dto';

export class ListVideosResponseDto {
  @ApiProperty({ type: [VideoResponseDto] })
  @Expose()
  @Type(() => VideoResponseDto)
  data: VideoResponseDto[];

  @ApiProperty({ type: VideoPaginationMetaDto })
  @Expose()
  @Type(() => VideoPaginationMetaDto)
  pagination: VideoPaginationMetaDto;
}
