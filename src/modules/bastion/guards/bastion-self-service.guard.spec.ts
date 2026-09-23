import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { BastionSelfServiceGuard } from './bastion-self-service.guard';
import {
  BASTION_OPTIONS,
  BastionJwksService,
  BastionModuleOptions,
} from '@heyatom/bastion-client/nest';
import { BastionTokenVerifier } from '../bastion-token-verifier.service';
import { UserJwtPayload } from '../bastion.types';

describe('BastionSelfServiceGuard', () => {
  const bastionPayload: UserJwtPayload = {
    sub: 'bastion-user-1',
    tenantId: 'tenant-1',
    tenantSlug: 'heyatom',
    email: 'user@example.com',
    username: 'user',
    image: null,
    preferredLocale: null,
    appSlug: 'meridian',
    role: 'MEMBER',
    permissions: [],
    iat: 0,
    exp: 0,
  };

  const mockJwks = { verify: jest.fn() };

  /** Builds a guard over the supplied `BastionModule` options. */
  const buildGuard = async (
    options: Pick<BastionModuleOptions, 'serviceSlug' | 'acceptedAppSlugs'>,
  ): Promise<BastionSelfServiceGuard> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BastionSelfServiceGuard,
        BastionTokenVerifier,
        { provide: BastionJwksService, useValue: mockJwks },
        {
          provide: BASTION_OPTIONS,
          useValue: { baseUrl: 'http://bastion', ...options },
        },
      ],
    }).compile();

    return module.get<BastionSelfServiceGuard>(BastionSelfServiceGuard);
  };

  /** Returns a context whose getRequest() is stable across calls, so the bastionUser set by the guard is observable. */
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
    mockJwks.verify.mockResolvedValue(bastionPayload);
  });

  it('accepts a verified token without requiring any console permission', async () => {
    const guard = await buildGuard({
      serviceSlug: 'fileharbor',
      acceptedAppSlugs: ['fileharbor', 'meridian'],
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
      serviceSlug: 'fileharbor',
      acceptedAppSlugs: ['fileharbor'],
    });

    const { context } = contextWithHeaders({ authorization: 'Bearer token' });
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Invalid app context'),
    );
  });

  it('rejects a request with no Authorization header', async () => {
    const guard = await buildGuard({
      serviceSlug: 'fileharbor',
      acceptedAppSlugs: ['fileharbor', 'meridian'],
    });

    const { context } = contextWithHeaders({});
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Missing or invalid Authorization header'),
    );
  });
});
