import { SkipThrottle } from '@nestjs/throttler';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import {
  ApiPaginatedResponse,
  paginate,
  PaginatedResult,
} from '@heyatom/nest-common';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';
import { CurrentAdminUser } from '@/modules/bastion/decorators/current-admin-user.decorator';
import { RequirePermission } from '@/modules/bastion/decorators/require-permission.decorator';
import { Audit, AuditRequest } from '@heyatom/bastion-client/nest';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { ImageService } from '@/modules/image/image.service';
import { RouteHelperService } from '@/utils/route.utils';
import { Prisma } from '@prisma/client';
import {
  AdminDeleteResponseDto,
  AdminImageShareLinkResponseDto,
} from '../dto/admin-response.dto';
import {
  AdminCreateShareLinkDto,
  AdminShareLinkListQuery,
} from '../dto/admin-share-link.dto';
import {
  assertClientAccess,
  resolveAllowedClients,
} from '../helpers/admin-access.helper';

const LINK_IMAGE_SELECT = {
  id: true,
  originalName: true,
  isPrivate: true,
  clientId: true,
  client: { select: { id: true, name: true } },
} satisfies Prisma.ImageSelect;

type LinkImage = Prisma.ImageGetPayload<{ select: typeof LINK_IMAGE_SELECT }>;
type LinkRow = {
  id: string;
  imageId: string;
  readToken: string;
  createdAt: Date;
  expiresAt: Date | null;
};

@ApiTags('Admin - Image Share Links')
// Every console call reaches us from Meridian's BFF, one IP for every admin: an
// IP-keyed bucket would be shared by all of them. Bastion auth + permissions gate it.
@SkipThrottle()
@Controller('admin/image-share-links')
@UseGuards(BastionUserGuard)
@ApiBearerAuth()
@RequirePermission('fileharbor-media.manage')
export class ImageShareLinksAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly imageService: ImageService,
    private readonly route: RouteHelperService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List image share links (scoped to accessible clients)',
    description:
      'An unknown image and an image outside the caller scope both give an empty list.',
  })
  @ApiPaginatedResponse(AdminImageShareLinkResponseDto)
  async listShareLinks(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Query() query: AdminShareLinkListQuery = new AdminShareLinkListQuery(),
  ): Promise<PaginatedResult<AdminImageShareLinkResponseDto>> {
    // Admin scope is the client, not the uploader: go straight to the table.
    const where: Prisma.ImageShareLinkWhereInput = {};
    if (query.imageId) where.imageId = query.imageId;
    if (query.clientId) {
      assertClientAccess(adminUser, query.clientId);
      where.image = { clientId: query.clientId };
    } else {
      where.image = { clientId: { in: resolveAllowedClients(adminUser) } };
    }
    // Same "active" predicate as findAdminImageById's activeShareLinks count.
    const now = new Date();
    if (query.status === 'active') {
      where.OR = [{ expiresAt: null }, { expiresAt: { gt: now } }];
    } else if (query.status === 'expired') {
      where.expiresAt = { lte: now };
    }

    const [rows, total] = await Promise.all([
      this.prisma.imageShareLink.findMany({
        where,
        include: { image: { select: LINK_IMAGE_SELECT } },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.imageShareLink.count({ where }),
    ]);

    return paginate(
      rows.map((row) => this.toResponse(row, row.image, now)),
      total,
      query,
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a share link on a private image (admin)' })
  @ApiResponse({ status: 201, type: AdminImageShareLinkResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid expiry, or IMAGE_NOT_PRIVATE',
  })
  @ApiResponse({ status: 403, description: 'Image client outside scope' })
  @ApiResponse({ status: 404, description: 'Image not found' })
  // Never the token: whoever reads the audit log must not get the image.
  @Audit('fh_share_link.created', {
    metadata: (r: AdminImageShareLinkResponseDto) => ({
      shareLinkId: r.id,
      imageId: r.imageId,
      expiresAt: r.expiresAt,
    }),
  })
  async createShareLink(
    @Body() dto: AdminCreateShareLinkDto,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminImageShareLinkResponseDto> {
    const image = await this.prisma.image.findUnique({
      where: { id: dto.imageId },
      select: LINK_IMAGE_SELECT,
    });
    if (!image) throw new NotFoundException('Image not found');
    assertClientAccess(adminUser, image.clientId);

    // A link on a public image adds nothing today, and would silently grant
    // access the day the image turns private.
    if (!image.isPrivate) {
      throw new BadRequestException({
        code: 'IMAGE_NOT_PRIVATE',
        message: 'Share links can only be created on private images',
      });
    }

    const link = await this.imageService.createShareLinkFor(
      image.id,
      dto.expiresAt,
    );
    return this.toResponse(link, image, new Date());
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an image share link (admin)' })
  @ApiResponse({ status: 200, type: AdminDeleteResponseDto })
  @ApiResponse({ status: 404, description: 'Share link not found' })
  @ApiResponse({
    status: 403,
    description: 'Admin has no access to the related client',
  })
  @Audit('fh_share_link.deleted', {
    metadata: (_r: unknown, req: AuditRequest) => ({
      shareLinkId: req.params.id,
    }),
  })
  async deleteShareLink(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminDeleteResponseDto> {
    const shareLink = await this.prisma.imageShareLink.findUnique({
      where: { id },
      include: {
        image: { select: { clientId: true } },
      },
    });

    if (!shareLink) {
      throw new NotFoundException('Share link not found');
    }

    assertClientAccess(adminUser, shareLink.image.clientId);

    await this.prisma.imageShareLink.delete({ where: { id } });

    return plainToInstance(
      AdminDeleteResponseDto,
      { success: true, message: 'Share link deleted successfully' },
      { excludeExtraneousValues: true },
    );
  }

  private toResponse(
    link: LinkRow,
    image: LinkImage,
    now: Date,
  ): AdminImageShareLinkResponseDto {
    return plainToInstance(
      AdminImageShareLinkResponseDto,
      {
        id: link.id,
        imageId: link.imageId,
        clientId: image.clientId,
        readToken: link.readToken,
        shareUrl: `${this.route.fullUrl('images', link.imageId)}?token=${link.readToken}`,
        createdAt: link.createdAt,
        expiresAt: link.expiresAt,
        isExpired: !!link.expiresAt && link.expiresAt <= now,
        image,
        client: image.client,
      },
      { excludeExtraneousValues: true },
    );
  }
}
