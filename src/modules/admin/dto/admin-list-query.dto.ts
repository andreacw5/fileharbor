import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PageParams } from '@heyatom/nest-common';
import { OPTIMIZE_STATUSES } from '@/modules/admin/helpers/admin-query.helper';

/*
 * Admin list queries. Filters live on the DTO: the global pipe forbids undeclared
 * query params. Flags the controllers already parse (isPrivate, public,
 * isBookmarked, optimizeStatus, comma-separated tags) stay strings, so an empty
 * value keeps meaning "no filter".
 */

export const MEDIA_SORT_FIELDS = [
  'createdAt',
  'size',
  'originalName',
  'views',
  'downloads',
] as const;
export type MediaSortField = (typeof MEDIA_SORT_FIELDS)[number];

class AdminScopedListQuery extends PageParams {
  @ApiPropertyOptional({ description: 'Scope to a specific client' })
  @IsOptional()
  @IsString()
  clientId?: string;
}

class AdminMediaListQuery extends AdminScopedListQuery {
  @ApiPropertyOptional({ description: 'Creator id (internal)' })
  @IsOptional()
  @IsString()
  creatorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  albumId?: string;

  @ApiPropertyOptional({ description: 'Search by original filename' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Filter by tags (repeated or comma-separated)',
  })
  @IsOptional()
  @IsString({ each: true })
  tags?: string | string[];

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'Only private (true) or only public (false) files',
  })
  @IsOptional()
  @IsString()
  isPrivate?: string;

  @ApiPropertyOptional({ enum: MEDIA_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(MEDIA_SORT_FIELDS)
  sortBy: MediaSortField = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}

export class AdminVideoListQuery extends AdminMediaListQuery {}

export class AdminImageListQuery extends AdminMediaListQuery {
  @ApiPropertyOptional({
    description: 'Only images with this dHash (64 hex chars)',
  })
  @IsOptional()
  @IsString()
  dHash?: string;

  @ApiPropertyOptional({
    enum: OPTIMIZE_STATUSES,
    description:
      'optimized, pending (the job will retry) or failed (the job gave up)',
  })
  @IsOptional()
  @IsString()
  optimizeStatus?: string;
}

export class AdminAvatarListQuery extends AdminScopedListQuery {
  @ApiPropertyOptional({ description: "Creator's externalId" })
  @IsOptional()
  @IsString()
  creatorId?: string;

  @ApiPropertyOptional({
    description: "Creator's externalId or username, contains, case-insensitive",
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: OPTIMIZE_STATUSES,
    description:
      'optimized, pending (the job will retry) or failed (the job gave up)',
  })
  @IsOptional()
  @IsString()
  optimizeStatus?: string;
}

export class AdminAlbumListQuery extends AdminScopedListQuery {
  @ApiPropertyOptional({ description: "Creator's externalId" })
  @IsOptional()
  @IsString()
  creatorId?: string;

  @ApiPropertyOptional({ description: 'Search by album name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsString()
  public?: string;
}

export class AdminCreatorListQuery extends AdminScopedListQuery {
  @ApiPropertyOptional({ description: 'Search by externalId or username' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description:
      'If true, returns only creators bookmarked by the current admin',
  })
  @IsOptional()
  @IsString()
  isBookmarked?: string;
}

export class AdminVideoBookmarkListQuery extends AdminScopedListQuery {
  @ApiPropertyOptional({ description: 'Search by original filename' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class AdminBookmarkListQuery extends AdminVideoBookmarkListQuery {
  @ApiPropertyOptional({
    type: [String],
    description: 'Filter by tags (repeated or comma-separated)',
  })
  @IsOptional()
  @IsString({ each: true })
  tags?: string | string[];
}
