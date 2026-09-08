import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { AdminJwtPayload } from '@/modules/admin-auth/guards/admin-jwt.guard';
import {
  resolveAllowedClients,
  assertClientAccess,
} from '@/modules/admin/helpers/admin-access.helper';
import { paginate, PaginatedResult } from '@/common/pagination';
import { TagListItemDto, TagPageParams } from './dto/tag-response.dto';

@Injectable()
export class TagService {

  private readonly logger = new Logger(TagService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns tags, optionally scoped by clientId and filtered by a search string,
   * ordered by name.
   *
   * Tags are stored per client (`@@unique([clientId, name])`), so a query that
   * spans several accessible clients can return the same name more than once —
   * one row per client, each with its own counts. Rows carry their `client` so
   * those repeats stay distinguishable; merging them by name would mean summing
   * the counts and dropping the client, which is a different endpoint.
   *
   * Counts cover both images and videos: a tag applied only to videos is a real
   * tag, and reporting it as `imageCount: 0` alone reads as broken data.
   */
  async listTags(
    admin: AdminJwtPayload,
    filters: { clientId?: string; search?: string } = {},
    params: TagPageParams = new TagPageParams(),
  ): Promise<PaginatedResult<TagListItemDto>> {
    this.logger.log(
      `listTags called by admin=${admin.sub} clientId=${filters.clientId ?? 'all'} search="${filters.search ?? ''}" page=${params.page} limit=${params.limit}`,
    );

    const where: Record<string, any> = {};

    if (filters.clientId) {
      assertClientAccess(admin, filters.clientId);
      where.clientId = filters.clientId;
    } else {
      const allowed = resolveAllowedClients(admin);
      if (allowed !== null) {
        where.clientId = { in: allowed };
      }
    }

    if (filters.search) {
      where.name = { contains: filters.search, mode: 'insensitive' };
    }

    const [rows, total] = await Promise.all([
      this.prisma.tag.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: params.skip,
        take: params.limit,
        select: {
          id: true,
          name: true,
          clientId: true,
          client: { select: { id: true, name: true, domain: true } },
          _count: { select: { imageTags: true, videoTags: true } },
        },
      }),
      this.prisma.tag.count({ where }),
    ]);

    const data: TagListItemDto[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      clientId: row.clientId,
      client: row.client
        ? { id: row.client.id, name: row.client.name, domain: row.client.domain ?? undefined }
        : undefined,
      imageCount: row._count.imageTags,
      videoCount: row._count.videoTags,
    }));

    this.logger.debug(`listTags returned ${data.length} of ${total} tags (page ${params.page})`);

    return paginate(data, total, params);
  }
}
