import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { PageParams } from '@heyatom/nest-common';

/** Filters live on the DTO: the global pipe forbids undeclared query params. */
export class AdminDuplicateListQuery extends PageParams {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @ApiPropertyOptional({ description: 'Only this client' })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({ description: 'Only images of this creator (id)' })
  @IsOptional()
  @IsUUID()
  creatorId?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Group across clients (key = dHash alone). fullAccess principals only, 403 otherwise.',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  crossClient = false;
}

export class AdminDuplicateImageDto {
  @ApiProperty() id: string;
  @ApiProperty() clientId: string;
  @ApiProperty() originalName: string;
  @ApiProperty() width: number;
  @ApiProperty() height: number;
  @ApiProperty() size: number;
  @ApiProperty() createdAt: Date;
  @ApiProperty() isPrivate: boolean;
  @ApiProperty() creatorExternalId: string;
}

export class AdminDuplicateGroupDto {
  @ApiProperty({ example: '3c3e1e0f0f1e3c3c' }) dHash: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'null only with crossClient=true',
  })
  clientId: string | null;
  @ApiProperty() count: number;
  @ApiProperty({ description: 'Sum of size over the whole group' })
  totalBytes: number;
  @ApiProperty({
    type: [AdminDuplicateImageDto],
    description: 'Up to 6, oldest first',
  })
  images: AdminDuplicateImageDto[];
}
