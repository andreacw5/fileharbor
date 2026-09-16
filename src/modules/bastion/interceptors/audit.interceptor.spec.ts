// jose is ESM-only, pulled in transitively via AuditInterceptor → BastionAuditService.
jest.mock('jose', () => ({ decodeJwt: jest.fn() }));

import { of, throwError, firstValueFrom } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { AuditInterceptor } from './audit.interceptor';
import { AuditDescriptor } from '../decorators/audit.decorator';

const makeCtx = (req: Record<string, unknown> = {}) =>
  ({
    getHandler: () => jest.fn(),
    switchToHttp: () => ({ getRequest: () => req }),
  }) as any;

function setup() {
  const reflector = { get: jest.fn() } as unknown as Reflector;
  const audit = { writeAsAdmin: jest.fn().mockResolvedValue(undefined) };
  const interceptor = new AuditInterceptor(reflector, audit as any);
  return { reflector, audit, interceptor };
}

describe('AuditInterceptor', () => {
  afterEach(() => jest.clearAllMocks());

  it('does nothing when the handler has no @Audit() metadata', async () => {
    const { reflector, audit, interceptor } = setup();
    (reflector.get as jest.Mock).mockReturnValue(undefined);
    const next = { handle: jest.fn().mockReturnValue(of({ id: 'x' })) };

    const result = await firstValueFrom(
      interceptor.intercept(makeCtx(), next as any),
    );

    expect(result).toEqual({ id: 'x' });
    expect(audit.writeAsAdmin).not.toHaveBeenCalled();
  });

  it('writes the event with the metadata built from the response and request', async () => {
    const { reflector, audit, interceptor } = setup();
    const descriptor: AuditDescriptor = {
      event: 'fh_image.uploaded',
      options: {
        metadata: (result: any, req: any) => ({
          id: result.id,
          name: result.name,
          param: req.params.foo,
        }),
      },
    };
    (reflector.get as jest.Mock).mockReturnValue(descriptor);
    const req = { params: { foo: 'bar' }, body: {}, adminUser: { sub: 'u1' } };
    const next = {
      handle: jest.fn().mockReturnValue(of({ id: 'c1', name: 'photo.webp' })),
    };

    const result = await firstValueFrom(
      interceptor.intercept(makeCtx(req), next as any),
    );

    expect(result).toEqual({ id: 'c1', name: 'photo.webp' });
    expect(audit.writeAsAdmin).toHaveBeenCalledWith(
      'fh_image.uploaded',
      { sub: 'u1' },
      { id: 'c1', name: 'photo.webp', param: 'bar' },
    );
  });

  it('does not touch the response value (tap, not map)', async () => {
    const { reflector, interceptor } = setup();
    const descriptor: AuditDescriptor = {
      event: 'fh_image.uploaded',
      options: {},
    };
    (reflector.get as jest.Mock).mockReturnValue(descriptor);
    const original = { id: 'c1' };
    const next = { handle: jest.fn().mockReturnValue(of(original)) };

    const result = await firstValueFrom(
      interceptor.intercept(makeCtx(), next as any),
    );

    expect(result).toBe(original);
  });

  it('responds successfully even when writeAsAdmin rejects', async () => {
    const { reflector, audit, interceptor } = setup();
    audit.writeAsAdmin.mockRejectedValue(new Error('bastion down'));
    const descriptor: AuditDescriptor = {
      event: 'fh_image.uploaded',
      options: {},
    };
    (reflector.get as jest.Mock).mockReturnValue(descriptor);
    const next = { handle: jest.fn().mockReturnValue(of({ id: 'c1' })) };

    const result = await firstValueFrom(
      interceptor.intercept(makeCtx(), next as any),
    );

    expect(result).toEqual({ id: 'c1' });
  });

  it('responds successfully even when the metadata builder throws', async () => {
    const { reflector, audit, interceptor } = setup();
    const descriptor: AuditDescriptor = {
      event: 'fh_image.uploaded',
      options: {
        metadata: () => {
          throw new Error('builder blew up');
        },
      },
    };
    (reflector.get as jest.Mock).mockReturnValue(descriptor);
    const next = { handle: jest.fn().mockReturnValue(of({ id: 'c1' })) };

    const result = await firstValueFrom(
      interceptor.intercept(makeCtx(), next as any),
    );

    expect(result).toEqual({ id: 'c1' });
    expect(audit.writeAsAdmin).not.toHaveBeenCalled();
  });

  it('propagates a handler error untouched (no swallowing on the error path)', async () => {
    const { reflector, audit, interceptor } = setup();
    const descriptor: AuditDescriptor = {
      event: 'fh_image.uploaded',
      options: {},
    };
    (reflector.get as jest.Mock).mockReturnValue(descriptor);
    const boom = new Error('handler failed');
    const next = { handle: jest.fn().mockReturnValue(throwError(() => boom)) };

    await expect(
      firstValueFrom(interceptor.intercept(makeCtx(), next as any)),
    ).rejects.toBe(boom);
    expect(audit.writeAsAdmin).not.toHaveBeenCalled();
  });

  it('defaults metadata to {} when no builder is provided', async () => {
    const { reflector, audit, interceptor } = setup();
    const descriptor: AuditDescriptor = {
      event: 'fh_album.deleted',
      options: {},
    };
    (reflector.get as jest.Mock).mockReturnValue(descriptor);
    const req = { params: {}, body: {}, adminUser: undefined };
    const next = { handle: jest.fn().mockReturnValue(of({ id: 's1' })) };

    await firstValueFrom(interceptor.intercept(makeCtx(req), next as any));

    expect(audit.writeAsAdmin).toHaveBeenCalledWith(
      'fh_album.deleted',
      undefined,
      {},
    );
  });
});
