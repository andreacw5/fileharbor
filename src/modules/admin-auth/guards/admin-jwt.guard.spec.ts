import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AdminJwtGuard, AdminJwtPayload } from './admin-jwt.guard';
import { BastionTokenVerifier, BastionJwtPayload } from '../bastion-token-verifier.service';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { PrismaService } from '@/modules/prisma/prisma.service';

describe('AdminJwtGuard', () => {
  const bastionPayload: BastionJwtPayload = {
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

  const mockJwtService = { verify: jest.fn() };

  /** Builds a guard whose ConfigService returns the supplied env values. */
  const buildGuard = async (config: Record<string, string>): Promise<AdminJwtGuard> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminJwtGuard,
        BastionTokenVerifier,
        Reflector,
        { provide: JwtService, useValue: mockJwtService },
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();

    return module.get<AdminJwtGuard>(AdminJwtGuard);
  };

  const acceptingGuard = () =>
    buildGuard({ bastionAppSlug: 'fileharbor', adminAcceptedAppSlugs: 'fileharbor,meridian' });

  /**
   * A context carrying a request plus a handler that may declare a required
   * permission through the same metadata key the decorator writes.
   */
  const contextWithToken = (
    requiredPermission?: string,
  ): { context: ExecutionContext; request: { adminUser?: AdminJwtPayload } } => {
    const request: { headers: Record<string, string>; adminUser?: AdminJwtPayload } = {
      headers: { authorization: 'Bearer token' },
    };
    const handler = () => undefined;
    if (requiredPermission) Reflect.defineMetadata(REQUIRE_PERMISSION_KEY, requiredPermission, handler);

    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => class {},
    } as unknown as ExecutionContext;

    return { context, request };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Bypass JWKS by stubbing the network-bound key fetch; slug logic is what matters here.
    // getPublicKeyPem lives on BastionTokenVerifier, shared with BastionUserJwtGuard.
    jest.spyOn(BastionTokenVerifier.prototype as any, 'getPublicKeyPem').mockResolvedValue('pem');
    mockJwtService.verify.mockReturnValue(bastionPayload);
    mockPrismaService.adminIdentity.findUnique.mockResolvedValue(null);
    mockPrismaService.client.findMany.mockResolvedValue([{ id: 'client-a' }]);
  });

  describe('app context', () => {
    it('accepts a token whose appSlug is in ADMIN_ACCEPTED_APP_SLUGS', async () => {
      const guard = await acceptingGuard();
      await expect(guard.canActivate(contextWithToken().context)).resolves.toBe(true);
    });

    it('rejects a token whose appSlug is not listed', async () => {
      const guard = await buildGuard({
        bastionAppSlug: 'fileharbor',
        adminAcceptedAppSlugs: 'fileharbor,gatherly',
      });

      await expect(guard.canActivate(contextWithToken().context)).rejects.toThrow(
        new UnauthorizedException('Invalid app context'),
      );
    });

    it('falls back to BASTION_APP_SLUG alone when the list is unset', async () => {
      const guard = await buildGuard({ bastionAppSlug: 'fileharbor', adminAcceptedAppSlugs: '' });

      await expect(guard.canActivate(contextWithToken().context)).rejects.toThrow(
        new UnauthorizedException('Invalid app context'),
      );

      const ownSlugGuard = await buildGuard({
        bastionAppSlug: 'meridian',
        adminAcceptedAppSlugs: '',
      });

      await expect(ownSlugGuard.canActivate(contextWithToken().context)).resolves.toBe(true);
    });
  });

  describe('permissions', () => {
    it('lets SUPER_ADMIN through a route that declares no permission', async () => {
      const guard = await acceptingGuard();
      await expect(guard.canActivate(contextWithToken().context)).resolves.toBe(true);
    });

    it('refuses a non-super caller on a route with no permission metadata', async () => {
      mockJwtService.verify.mockReturnValue({ ...bastionPayload, role: 'ADMIN' });
      const guard = await acceptingGuard();

      await expect(guard.canActivate(contextWithToken().context)).rejects.toThrow(
        new ForbiddenException('Insufficient permissions'),
      );
    });

    it('refuses a non-super caller lacking the declared permission', async () => {
      mockJwtService.verify.mockReturnValue({
        ...bastionPayload,
        role: 'ADMIN',
        permissions: ['fileharbor-media.manage'],
      });
      const guard = await acceptingGuard();

      await expect(
        guard.canActivate(contextWithToken('fileharbor-library.manage').context),
      ).rejects.toThrow(new ForbiddenException('Insufficient permissions'));
    });

    it('accepts a non-super caller holding the declared permission', async () => {
      mockJwtService.verify.mockReturnValue({
        ...bastionPayload,
        role: 'ADMIN',
        permissions: ['fileharbor-media.manage'],
      });
      const guard = await acceptingGuard();

      await expect(
        guard.canActivate(contextWithToken('fileharbor-media.manage').context),
      ).resolves.toBe(true);
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
        where: { OR: [{ ownerPrincipalId: null }, { ownerPrincipalId: 'principal-1' }] },
        select: { id: true },
      });
      expect(request.adminUser).toMatchObject({ actorId: 'principal-1', fullAccess: true });
    });

    it('adds a linked caller’s own personal clients to their tenant’s', async () => {
      mockPrismaService.adminIdentity.findUnique.mockResolvedValue({
        principal: { id: 'principal-2', fullAccess: false },
      });
      const guard = await acceptingGuard();

      await guard.canActivate(contextWithToken().context);

      expect(mockPrismaService.client.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ bastionTenantSlug: 'heyatom' }, { ownerPrincipalId: 'principal-2' }],
        },
        select: { id: true },
      });
    });
  });
});
