import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { AdminJwtPayload } from '@/modules/admin/guards/admin-jwt.guard';
import {
  resolveAllowedClients,
  assertClientAccess,
} from '@/modules/admin/helpers/admin-access.helper';
import { TagsResponseDto } from './dto/tag-response.dto';

@Injectable()
export class TagService {

  private readonly logger = new Logger(TagService.name);

  constructor(private readonly prisma: PrismaService) {}


  // ─── Tags ─────────────────────────────────────────────────────────────────

  /**
   * Returns distinct tags used across images, optionally scoped by clientId
   * and filtered by a search string. Uses a raw SQL `unnest` for efficiency —
   * no full table scan in application memory.
   */
  async listTags(
    admin: AdminJwtPayload,
    filters: { clientId?: string; search?: string; limit?: number } = {},
  ): Promise<TagsResponseDto> {
    this.logger.log(
      `listTags called by admin=${admin.sub} clientId=${filters.clientId ?? 'all'} search="${filters.search ?? ''}" limit=${filters.limit ?? 200}`,
    );

    const limit = Math.min(filters.limit || 200, 500);

    let clientConstraint: Prisma.Sql;
    if (filters.clientId) {
      assertClientAccess(admin, filters.clientId);
      clientConstraint = Prisma.sql`"clientId" = ${filters.clientId}`;
    } else {
      const allowed = resolveAllowedClients(admin);
      if (allowed !== null) {
        clientConstraint = Prisma.sql`"clientId" = ANY(${allowed}::text[])`;
      } else {
        clientConstraint = Prisma.sql`TRUE`;
      }
    }

    const searchConstraint = filters.search
      ? Prisma.sql`AND tag ILIKE ${'%' + filters.search + '%'}`
      : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<{ tag: string }[]>`
      SELECT tag FROM (
        SELECT DISTINCT unnest(tags) AS tag
        FROM "images"
        WHERE ${clientConstraint}
          AND tags IS NOT NULL
          AND array_length(tags, 1) > 0
      ) sub
      WHERE TRUE ${searchConstraint}
      ORDER BY tag
      LIMIT ${limit}
    `;

    const tags = rows.map((r) => r.tag);
    this.logger.debug(`listTags returned ${tags.length} distinct tags`);

    return plainToInstance(
      TagsResponseDto,
      { tags, total: tags.length },
      { excludeExtraneousValues: true },
    );
  }
}

