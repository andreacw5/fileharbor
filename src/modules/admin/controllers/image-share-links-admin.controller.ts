import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { AdminJwtGuard, AdminJwtPayload } from '@/modules/admin-auth/guards/admin-jwt.guard';
import { AdminUser } from '@/modules/admin-auth/decorators/admin-user.decorator';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { ImageService } from '@/modules/image/image.service';
import {
  AdminDeleteResponseDto,
  AdminImageShareLinkResponseDto,
  AdminImageShareLinksListResponseDto,
} from '../dto/admin-response.dto';
import { assertClientAccess, resolveAllowedClients } from '../helpers/admin-access.helper';

@ApiTags('Admin - Image Share Links')
@Controller('admin/image-share-links')
@UseGuards(AdminJwtGuard)
@ApiBearerAuth()
export class ImageShareLinksAdminController {
  constructor(
    private readonly imageService: ImageService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List image share links (scoped to accessible clients)' })
  @ApiQuery({ name: 'clientId', required: false, description: 'Filter by client ID' })
  @ApiQuery({ name: 'imageId', required: false, description: 'Filter by image ID' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  @ApiResponse({ status: 200, type: AdminImageShareLinksListResponseDto })
  async listShareLinks(
    @AdminUser() adminUser: AdminJwtPayload,
    @Query('clientId') clientId?: string,
    @Query('imageId') imageId?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ): Promise<AdminImageShareLinksListResponseDto> {
    const pageNum = Number(page) || 1;
    const take = Math.min(Number(perPage) || 20, 100);
    const skip = Math.max((pageNum - 1) * take, 0);

    const allowedClients = resolveAllowedClients(adminUser);

    let shareLinks: Array<{
      id: string;
      imageId: string;
      clientId: string;
      readToken: string;
      createdAt: Date;
      expiresAt: Date | null;
    }> = [];
    let total = 0;

    if (imageId) {
      const image = await this.imageService.getImageById(imageId);

      if (clientId && image.clientId !== clientId) {
        total = 0;
      } else if (allowedClients !== null && !allowedClients.includes(image.clientId)) {
        total = 0;
      } else {
        const links = await this.imageService.getShareLinks(image.id, image.clientId, image.userId);
        const mapped = links.map((link) => ({
          id: link.id,
          imageId: link.imageId,
          clientId: image.clientId,
          readToken: link.readToken,
          createdAt: link.createdAt,
          expiresAt: link.expiresAt ?? null,
        }));

        total = mapped.length;
        shareLinks = mapped.slice(skip, skip + take);
      }
    } else {
      const where: any = {};
      if (clientId) {
        assertClientAccess(adminUser, clientId);
        where.image = { clientId };
      } else if (allowedClients !== null) {
        where.image = { clientId: { in: allowedClients } };
      }

      const [rows, count] = await Promise.all([
        this.prisma.imageShareLink.findMany({
          where,
          include: {
            image: {
              select: {
                clientId: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        this.prisma.imageShareLink.count({ where }),
      ]);

      shareLinks = rows.map((row) => ({
        id: row.id,
        imageId: row.imageId,
        clientId: row.image.clientId,
        readToken: row.readToken,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      }));
      total = count;
    }

    const now = new Date();
    const data = shareLinks.map((link) =>
      plainToInstance(
        AdminImageShareLinkResponseDto,
        {
          id: link.id,
          imageId: link.imageId,
          clientId: link.clientId,
          readToken: link.readToken,
          createdAt: link.createdAt,
          expiresAt: link.expiresAt,
          isExpired: !!link.expiresAt && link.expiresAt <= now,
        },
        { excludeExtraneousValues: true },
      ),
    );

    return plainToInstance(
      AdminImageShareLinksListResponseDto,
      {
        data,
        pagination: {
          page: pageNum,
          perPage: take,
          total,
          totalPages: Math.ceil(total / take),
        },
      },
      { excludeExtraneousValues: true },
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an image share link (admin)' })
  @ApiResponse({ status: 200, type: AdminDeleteResponseDto })
  @ApiResponse({ status: 404, description: 'Share link not found' })
  @ApiResponse({ status: 403, description: 'Admin has no access to the related client' })
  async deleteShareLink(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminDeleteResponseDto> {
    const shareLink = await this.prisma.imageShareLink.findUnique({
      where: { id },
      include: {
        image: {
          select: {
            clientId: true,
            userId: true,
          },
        },
      },
    });

    if (!shareLink) {
      throw new NotFoundException('Share link not found');
    }

    assertClientAccess(adminUser, shareLink.image.clientId);

    await this.imageService.deleteShareLink(id, shareLink.image.clientId, shareLink.image.userId);

    return plainToInstance(
      AdminDeleteResponseDto,
      { success: true, message: 'Share link deleted successfully' },
      { excludeExtraneousValues: true },
    );
  }
}

