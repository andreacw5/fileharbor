import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { BastionUserJwtGuard } from './bastion-user-jwt.guard';
import {
  BastionTokenVerifier,
  BastionJwtPayload,
} from '../bastion-token-verifier.service';

describe('BastionUserJwtGuard', () => {
  const bastionPayload: BastionJwtPayload = {
    sub: 'bastion-user-1',
    tenantId: 'tenant-1',
    tenantSlug: 'heyatom',
    email: 'user@example.com',
    username: 'user',
    appSlug: 'meridian',
    role: 'MEMBER',
    permissions: [],
    iat: 0,
    exp: 0,
  };

  const mockJwtService = { verify: jest.fn() };

  /** Builds a guard whose ConfigService returns the supplied env values. */
  const buildGuard = async (
    config: Record<string, string>,
  ): Promise<BastionUserJwtGuard> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BastionUserJwtGuard,
        BastionTokenVerifier,
        { provide: JwtService, useValue: mockJwtService },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();

    return module.get<BastionUserJwtGuard>(BastionUserJwtGuard);
  };

  /** Returns a context whose getRequest() is stable across calls, so bastionUser set by the guard is observable. */
  const contextWithHeaders = (
    headers: Record<string, string>,
  ): { context: ExecutionContext; request: any } => {
    const request: any = { headers };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Bypass JWKS by stubbing the network-bound key fetch; slug/payload logic is what matters here.
    jest
      .spyOn(BastionTokenVerifier.prototype as any, 'getPublicKeyPem')
      .mockResolvedValue('pem');
    mockJwtService.verify.mockReturnValue(bastionPayload);
  });

  it('accepts a verified token without requiring any console permission', async () => {
    const guard = await buildGuard({
      bastionAppSlug: 'fileharbor',
      adminAcceptedAppSlugs: 'fileharbor,meridian',
    });

    const { context, request } = contextWithHeaders({
      authorization: 'Bearer token',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.bastionUser).toEqual({
      sub: bastionPayload.sub,
      tenantId: bastionPayload.tenantId,
      tenantSlug: bastionPayload.tenantSlug,
      appSlug: bastionPayload.appSlug,
      email: bastionPayload.email,
      username: bastionPayload.username,
    });
  });

  it('rejects a token whose appSlug is not accepted', async () => {
    const guard = await buildGuard({
      bastionAppSlug: 'fileharbor',
      adminAcceptedAppSlugs: 'fileharbor',
    });

    const { context } = contextWithHeaders({ authorization: 'Bearer token' });
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Invalid app context'),
    );
  });

  it('rejects a request with no Authorization header', async () => {
    const guard = await buildGuard({
      bastionAppSlug: 'fileharbor',
      adminAcceptedAppSlugs: 'fileharbor,meridian',
    });

    const { context } = contextWithHeaders({});
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Missing or invalid Authorization header'),
    );
  });
});
