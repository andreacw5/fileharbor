import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AdminJwtGuard, BastionJwtPayload } from './admin-jwt.guard';
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
    adminUser: { findUnique: jest.fn() },
    userCache: { upsert: jest.fn() },
  };

  const mockJwtService = { verify: jest.fn() };

  /** Builds a guard whose ConfigService returns the supplied env values. */
  const buildGuard = async (config: Record<string, string>): Promise<AdminJwtGuard> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminJwtGuard,
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

  const contextWithToken = (): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: 'Bearer token' } }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    // Bypass JWKS by stubbing the network-bound key fetch; slug logic is what matters here.
    jest
      .spyOn(AdminJwtGuard.prototype as any, 'getPublicKeyPem')
      .mockResolvedValue('pem');
    mockJwtService.verify.mockReturnValue(bastionPayload);
    mockPrismaService.adminUser.findUnique.mockResolvedValue({
      id: 'local-admin-1',
      active: true,
      allClientsAccess: true,
      clientAccess: [],
    });
    mockPrismaService.userCache.upsert.mockResolvedValue(undefined);
  });

  it('accepts a token whose appSlug is in ADMIN_ACCEPTED_APP_SLUGS', async () => {
    const guard = await buildGuard({
      bastionAppSlug: 'fileharbor',
      adminAcceptedAppSlugs: 'fileharbor, meridian',
    });

    await expect(guard.canActivate(contextWithToken())).resolves.toBe(true);
  });

  it('rejects a token whose appSlug is not listed', async () => {
    const guard = await buildGuard({
      bastionAppSlug: 'fileharbor',
      adminAcceptedAppSlugs: 'fileharbor,gatherly',
    });

    await expect(guard.canActivate(contextWithToken())).rejects.toThrow(
      new UnauthorizedException('Invalid app context'),
    );
  });

  it('falls back to BASTION_APP_SLUG alone when the list is unset', async () => {
    const guard = await buildGuard({
      bastionAppSlug: 'fileharbor',
      adminAcceptedAppSlugs: '',
    });

    await expect(guard.canActivate(contextWithToken())).rejects.toThrow(
      new UnauthorizedException('Invalid app context'),
    );

    const ownSlugGuard = await buildGuard({
      bastionAppSlug: 'meridian',
      adminAcceptedAppSlugs: '',
    });

    await expect(ownSlugGuard.canActivate(contextWithToken())).resolves.toBe(true);
  });

  it('rejects an accepted appSlug when no local AdminUser is granted', async () => {
    mockPrismaService.adminUser.findUnique.mockResolvedValue(null);

    const guard = await buildGuard({
      bastionAppSlug: 'fileharbor',
      adminAcceptedAppSlugs: 'fileharbor,meridian',
    });

    await expect(guard.canActivate(contextWithToken())).rejects.toThrow(
      new UnauthorizedException('Admin access not granted'),
    );
  });
});
