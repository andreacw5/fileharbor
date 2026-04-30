import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/modules/prisma/prisma.service';
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
   * and filtered by a search string.
   */
  async listTags(
    admin: AdminJwtPayload,
    filters: { clientId?: string; search?: string; limit?: number } = {},
  ): Promise<TagsResponseDto> {
    this.logger.log(
      `listTags called by admin=${admin.sub} clientId=${filters.clientId ?? 'all'} search="${filters.search ?? ''}" limit=${filters.limit ?? 200}`,
    );

    const limit = Math.min(filters.limit || 200, 500);

    const where: Record<string, any> = {
      imageTags: {
        some: {},
      },
    };

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
      where.name = {
        contains: filters.search,
        mode: 'insensitive',
      };
    }

    const rows = await this.prisma.tag.findMany({
      where,
      orderBy: {
        name: 'asc',
      },
      take: limit,
      select: {
        name: true,
        _count: {
          select: {
            imageTags: true,
          },
        },
      },
    });

    const tags = rows.map((row) => ({
      name: row.name,
      imageCount: row._count.imageTags,
    }));
    this.logger.debug(`listTags returned ${tags.length} distinct tags`);

    return plainToInstance(
      TagsResponseDto,
      { tags, total: tags.length },
      { excludeExtraneousValues: true },
    );
  }
}

