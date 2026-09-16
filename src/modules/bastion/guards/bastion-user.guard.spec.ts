import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { BastionUserGuard } from './bastion-user.guard';
import { BastionAuditService } from '../bastion-audit.service';
import { BastionJwksService } from '../bastion-jwks.service';
import { BastionTokenVerifier } from '../bastion-token-verifier.service';
import { AdminJwtPayload, UserJwtPayload } from '../bastion.types';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { PrismaService } from '@/modules/prisma/prisma.service';

describe('BastionUserGuard', () => {
  const bastionPayload: UserJwtPayload = {
    sub: 'bastion-user-1',
    tenantId: 'tenant-1',
    tenantSlug: 'heyatom',
    email: 'admin@example.com',
    username: 'admin',
    appSlug: 'meridian',
    role: 'SUPER_ADMIN',
    permissions: [],
    iat: 0,
    exp: 0,
  };

  const mockPrismaService = {
    adminIdentity: { findUnique: jest.fn() },
    client: { findMany: jest.fn() },
  };

  // The signature check is exercised in bastion-jwks.service.spec.ts; here the
  // JWKS service is stubbed so the tests are about slug, permission and scope.
  const mockJwks = { verify: jest.fn() };
  const mockAudit = { write: jest.fn(), writeAsAdmin: jest.fn() };

  /** Builds a guard whose ConfigService returns the supplied env values. */
  const buildGuard = async (
    config: Record<string, string>,
  ): Promise<BastionUserGuard> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BastionUserGuard,
        BastionTokenVerifier,
        Reflector,
        { provide: BastionJwksService, useValue: mockJwks },
        { provide: BastionAuditService, useValue: mockAudit },
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();

    return module.get<BastionUserGuard>(BastionUserGuard);
  };

  const acceptingGuard = () =>
    buildGuard({
      bastionAppSlug: 'fileharbor',
      adminAcceptedAppSlugs: 'fileharbor,meridian',
    });

  /**
   * A context carrying a request plus a handler that may declare a required
   * permission through the same metadata key the decorator writes.
   */
  const contextWithToken = (
    requiredPermission?: string,
  ): {
    context: ExecutionContext;
    request: { adminUser?: AdminJwtPayload };
  } => {
    const request: {
      headers: Record<string, string>;
      url?: string;
      adminUser?: AdminJwtPayload;
    } = {
      headers: { authorization: 'Bearer token' },
      url: '/admin/images',
    };
    const handler = () => undefined;
    if (requiredPermission)
      Reflect.defineMetadata(
        REQUIRE_PERMISSION_KEY,
        requiredPermission,
        handler,
      );

    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => class {},
    } as unknown as ExecutionContext;

    return { context, request };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockJwks.verify.mockResolvedValue(bastionPayload);
    mockPrismaService.adminIdentity.findUnique.mockResolvedValue(null);
    mockPrismaService.client.findMany.mockResolvedValue([{ id: 'client-a' }]);
  });

  describe('app context', () => {
    it('accepts a token whose appSlug is in ADMIN_ACCEPTED_APP_SLUGS', async () => {
      const guard = await acceptingGuard();
      await expect(guard.canActivate(contextWithToken().context)).resolves.toBe(
        true,
      );
    });

    it('rejects a token whose appSlug is not listed', async () => {
      const guard = await buildGuard({
        bastionAppSlug: 'fileharbor',
        adminAcceptedAppSlugs: 'fileharbor,gatherly',
      });

      await expect(
        guard.canActivate(contextWithToken().context),
      ).rejects.toThrow(new UnauthorizedException('Invalid app context'));
    });

    it('rejects a service-client token outright', async () => {
      mockJwks.verify.mockResolvedValue({
        sub: 'svc',
        type: 'service_client',
        serviceSlug: 'fileharbor',
        tenantId: 'tenant-1',
        tenantSlug: 'heyatom',
        scopes: [],
        iat: 0,
        exp: 0,
      });
      const guard = await acceptingGuard();

      await expect(
        guard.canActivate(contextWithToken().context),
      ).rejects.toThrow(
        new UnauthorizedException('Service client token not allowed'),
      );
    });

    it('falls back to BASTION_APP_SLUG alone when the list is unset', async () => {
      const guard = await buildGuard({
        bastionAppSlug: 'fileharbor',
        adminAcceptedAppSlugs: '',
      });

      await expect(
        guard.canActivate(contextWithToken().context),
      ).rejects.toThrow(new UnauthorizedException('Invalid app context'));

      const ownSlugGuard = await buildGuard({
        bastionAppSlug: 'meridian',
        adminAcceptedAppSlugs: '',
      });

      await expect(
        ownSlugGuard.canActivate(contextWithToken().context),
      ).resolves.toBe(true);
    });
  });

  describe('permissions', () => {
    it('lets SUPER_ADMIN through a route that declares no permission', async () => {
      const guard = await acceptingGuard();
      await expect(guard.canActivate(contextWithToken().context)).resolves.toBe(
        true,
      );
    });

    it('refuses a non-super caller on a route with no permission metadata', async () => {
      mockJwks.verify.mockResolvedValue({
        ...bastionPayload,
        role: 'ADMIN',
      });
      const guard = await acceptingGuard();

      await expect(
        guard.canActivate(contextWithToken().context),
      ).rejects.toThrow(new ForbiddenException('Insufficient permissions'));
    });

    it('refuses a non-super caller lacking the declared permission', async () => {
      mockJwks.verify.mockResolvedValue({
        ...bastionPayload,
        role: 'ADMIN',
        permissions: ['fileharbor-media.manage'],
      });
      const guard = await acceptingGuard();

      await expect(
        guard.canActivate(
          contextWithToken('fileharbor-library.manage').context,
        ),
      ).rejects.toThrow(new ForbiddenException('Insufficient permissions'));
    });

    it('accepts a non-super caller holding the declared permission', async () => {
      mockJwks.verify.mockResolvedValue({
        ...bastionPayload,
        role: 'ADMIN',
        permissions: ['fileharbor-media.manage'],
      });
      const guard = await acceptingGuard();

      await expect(
        guard.canActivate(contextWithToken('fileharbor-media.manage').context),
      ).resolves.toBe(true);
    });

    it('audits a refusal once, then stays quiet for the cooldown', async () => {
      mockJwks.verify.mockResolvedValue({
        ...bastionPayload,
        role: 'ADMIN',
      });
      const guard = await acceptingGuard();

      await expect(
        guard.canActivate(contextWithToken().context),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        guard.canActivate(contextWithToken().context),
      ).rejects.toThrow(ForbiddenException);

      expect(mockAudit.write).toHaveBeenCalledTimes(1);
      expect(mockAudit.write).toHaveBeenCalledWith(
        'admin.access_denied',
        expect.objectContaining({
          metadata: expect.objectContaining({
            reason: 'route_undeclared',
            appSlug: 'meridian',
          }),
        }),
      );
    });
  });

  describe('client scope', () => {
    it('scopes an unlinked caller to their tenant, whatever their role', async () => {
      const guard = await acceptingGuard();
      const { context, request } = contextWithToken();

      await guard.canActivate(context);

      expect(mockPrismaService.client.findMany).toHaveBeenCalledWith({
        where: { OR: [{ bastionTenantSlug: 'heyatom' }] },
        select: { id: true },
      });
      expect(request.adminUser).toMatchObject({
        principalId: null,
        fullAccess: false,
        actorId: 'sub:bastion-user-1',
        allowedClientIds: ['client-a'],
      });
    });

    it('gives a fullAccess principal every client but other principals’ personal ones', async () => {
      mockPrismaService.adminIdentity.findUnique.mockResolvedValue({
        principal: { id: 'principal-1', fullAccess: true },
      });
      const guard = await acceptingGuard();
      const { context, request } = contextWithToken();

      await guard.canActivate(context);

      expect(mockPrismaService.client.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ ownerPrincipalId: null }, { ownerPrincipalId: 'principal-1' }],
        },
        select: { id: true },
      });
      expect(request.adminUser).toMatchObject({
        actorId: 'principal-1',
        fullAccess: true,
      });
    });

    it('adds a linked caller’s own personal clients to their tenant’s', async () => {
      mockPrismaService.adminIdentity.findUnique.mockResolvedValue({
        principal: { id: 'principal-2', fullAccess: false },
      });
      const guard = await acceptingGuard();

      await guard.canActivate(contextWithToken().context);

      expect(mockPrismaService.client.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { bastionTenantSlug: 'heyatom' },
            { ownerPrincipalId: 'principal-2' },
          ],
        },
        select: { id: true },
      });
    });
  });
});
