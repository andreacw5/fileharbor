import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ImageShareLinksAdminController } from './image-share-links-admin.controller';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { ImageService } from '@/modules/image/image.service';
import { RouteHelperService } from '@/utils/route.utils';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';
import {
  AdminCreateShareLinkDto,
  AdminShareLinkListQuery,
} from '../dto/admin-share-link.dto';
import { CreateShareLinkDto } from '@/modules/image/dto/create-share-link.dto';

const IMG = '11111111-1111-4111-8111-111111111111';
const DAY = 86_400_000;

describe('ImageShareLinksAdminController', () => {
  const image = {
    id: IMG,
    originalName: 'a.png',
    isPrivate: true,
    clientId: 'client-1',
    client: { id: 'client-1', name: 'One' },
  };
  const link = {
    id: 'link-1',
    imageId: IMG,
    readToken: 'tok',
    createdAt: new Date('2026-10-01'),
    expiresAt: null,
    image,
  };
  const prisma = {
    image: { findUnique: jest.fn() },
    imageShareLink: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  };
  const imageService = { createShareLinkFor: jest.fn() };
  const route = {
    fullUrl: (...s: string[]) => `https://cdn.test/${s.join('/')}`,
  };
  const controller = new ImageShareLinksAdminController(
    prisma as unknown as PrismaService,
    imageService as unknown as ImageService,
    route as unknown as RouteHelperService,
  );
  const admin = (allowedClientIds: string[]) =>
    ({ allowedClientIds }) as AdminJwtPayload;
  const query = (q: Partial<AdminShareLinkListQuery>) =>
    Object.assign(new AdminShareLinkListQuery(), q);
  const future = () => new Date(Date.now() + 7 * DAY);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.imageShareLink.findMany.mockResolvedValue([link]);
    prisma.imageShareLink.count.mockResolvedValue(1);
    prisma.imageShareLink.findUnique.mockResolvedValue(link);
    prisma.image.findUnique.mockResolvedValue(image);
    imageService.createShareLinkFor.mockResolvedValue(link);
  });

  describe('list', () => {
    it('lists the active links of one image, scoped to the admin clients', async () => {
      const res = await controller.listShareLinks(
        admin(['client-1']),
        query({ imageId: IMG }),
      );

      const where = prisma.imageShareLink.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        imageId: IMG,
        image: { clientId: { in: ['client-1'] } },
      });
      expect(where.OR).toHaveLength(2);
      expect(res.meta).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1 });
      expect(res.data[0]).toMatchObject({
        id: 'link-1',
        clientId: 'client-1',
        shareUrl: `https://cdn.test/images/${IMG}?token=tok`,
        isExpired: false,
        image: { id: IMG, originalName: 'a.png', isPrivate: true },
        client: { id: 'client-1', name: 'One' },
      });
    });

    it('filters expired links, and none on status=all', async () => {
      await controller.listShareLinks(
        admin(['c']),
        query({ status: 'expired' }),
      );
      await controller.listShareLinks(admin(['c']), query({ status: 'all' }));

      const [expired, all] = prisma.imageShareLink.findMany.mock.calls.map(
        (c) => c[0].where,
      );
      expect(expired.expiresAt).toHaveProperty('lte');
      expect(all.OR).toBeUndefined();
      expect(all.expiresAt).toBeUndefined();
    });

    it('refuses a client filter outside the admin scope', async () => {
      await expect(
        controller.listShareLinks(
          admin(['client-1']),
          query({ clientId: 'client-2' }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.imageShareLink.findMany).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates a link on a private image in scope', async () => {
      const expiresAt = future();
      const res = await controller.createShareLink(
        { imageId: IMG, expiresAt },
        admin(['client-1']),
      );

      expect(imageService.createShareLinkFor).toHaveBeenCalledWith(
        IMG,
        expiresAt,
      );
      expect(res.shareUrl).toBe(`https://cdn.test/images/${IMG}?token=tok`);
    });

    it('answers 404 for an unknown image', async () => {
      prisma.image.findUnique.mockResolvedValue(null);
      await expect(
        controller.createShareLink(
          { imageId: IMG, expiresAt: future() },
          admin(['client-1']),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses an image of another client', async () => {
      await expect(
        controller.createShareLink(
          { imageId: IMG, expiresAt: future() },
          admin(['client-2']),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(imageService.createShareLinkFor).not.toHaveBeenCalled();
    });

    it('refuses a public image with IMAGE_NOT_PRIVATE', async () => {
      prisma.image.findUnique.mockResolvedValue({ ...image, isPrivate: false });
      const err = await controller
        .createShareLink(
          { imageId: IMG, expiresAt: future() },
          admin(['client-1']),
        )
        .catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ code: 'IMAGE_NOT_PRIVATE' });
      expect(imageService.createShareLinkFor).not.toHaveBeenCalled();
    });
  });

  describe('expiry validation', () => {
    const errorsOf = async (cls: any, body: object) =>
      (await validate(plainToInstance(cls, body))).map((e) => e.property);
    const iso = (offset: number) => new Date(Date.now() + offset).toISOString();

    it('admin: requires a valid future date within 365 days', async () => {
      expect(
        await errorsOf(AdminCreateShareLinkDto, {
          imageId: IMG,
          expiresAt: iso(DAY),
        }),
      ).toEqual([]);
      for (const expiresAt of [undefined, 'x', iso(-DAY), iso(366 * DAY)]) {
        expect(
          await errorsOf(AdminCreateShareLinkDto, { imageId: IMG, expiresAt }),
        ).toEqual(['expiresAt']);
      }
    });

    it('client path: optional, but rejects garbage and the past', async () => {
      expect(await errorsOf(CreateShareLinkDto, {})).toEqual([]);
      expect(
        await errorsOf(CreateShareLinkDto, { expiresAt: iso(DAY) }),
      ).toEqual([]);
      expect(await errorsOf(CreateShareLinkDto, { expiresAt: 'x' })).toEqual([
        'expiresAt',
      ]);
      expect(
        await errorsOf(CreateShareLinkDto, { expiresAt: iso(-DAY) }),
      ).toEqual(['expiresAt']);
    });
  });

  describe('delete', () => {
    it('revokes a link of an accessible client', async () => {
      await controller.deleteShareLink('link-1', admin(['client-1']));

      expect(prisma.imageShareLink.delete).toHaveBeenCalledWith({
        where: { id: 'link-1' },
      });
    });

    it('refuses to revoke a link of another client', async () => {
      await expect(
        controller.deleteShareLink('link-1', admin(['client-2'])),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.imageShareLink.delete).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown link', async () => {
      prisma.imageShareLink.findUnique.mockResolvedValue(null);

      await expect(
        controller.deleteShareLink('nope', admin(['client-1'])),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
