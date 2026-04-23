import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { plainToInstance } from 'class-transformer';
import { AdminJwtPayload } from '@/modules/admin/guards/admin-jwt.guard';
import {
  assertClientAccess,
  buildClientWhere,
} from '@/modules/admin/helpers/admin-access.helper';
import { UserResponseDto } from './dto/user-response.dto';

@Injectable()
export class UserService {

  private readonly logger = new Logger(UserService.name);

  constructor(private readonly prisma: PrismaService) {}


  // ─── Users ────────────────────────────────────────────────────────────────

  async listUsers(
    admin: AdminJwtPayload,
    filters: {
      clientId?: string;
      search?: string;
      page?: number;
      perPage?: number;
    } = {},
  ) {
    this.logger.log(
      `listUsers called by admin=${admin.sub} clientId=${filters.clientId ?? 'all'} search="${filters.search ?? ''}" page=${filters.page ?? 1}`,
    );

    const page = filters.page || 1;
    const perPage = filters.perPage || 20;
    const take = Math.min(perPage, 100);
    const skip = (page - 1) * take;
    const where: any = buildClientWhere(admin, filters.clientId);

    if (filters.search) {
      where.OR = [
        { externalUserId: { contains: filters.search, mode: 'insensitive' } },
        { username: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    // Exclude system user
    where.externalUserId = { ...(where.externalUserId || {}), not: 'system' };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          _count: { select: { images: true, avatars: true } },
          client: { select: { id: true, name: true, domain: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    this.logger.debug(`listUsers returned ${users.length}/${total} users`);

    const data = users.map((u) =>
      plainToInstance(
        UserResponseDto,
        {
          ...u,
          totalImages: u._count.images,
          totalAvatars: u._count.avatars,
        },
        { excludeExtraneousValues: true },
      ),
    );

    return {
      data,
      pagination: { page, perPage: take, total, totalPages: Math.ceil(total / take) },
    };
  }

  async getUser(userId: string, admin: AdminJwtPayload): Promise<UserResponseDto> {
    this.logger.log(`getUser called by admin=${admin.sub} userId=${userId}`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        _count: { select: { images: true, avatars: true, albums: true } },
        client: { select: { id: true, name: true, domain: true } },
      },
    });

    if (!user) {
      this.logger.warn(`getUser: user not found userId=${userId}`);
      throw new NotFoundException('User not found');
    }

    assertClientAccess(admin, user.clientId);

    this.logger.debug(`getUser: found user=${userId} clientId=${user.clientId}`);

    return plainToInstance(
      UserResponseDto,
      {
        ...user,
        totalImages: user._count.images,
        totalAvatars: user._count.avatars,
        totalAlbums: user._count.albums,
      },
      { excludeExtraneousValues: true },
    );
  }
}

