import { ArgumentsHost, ForbiddenException, Logger } from '@nestjs/common';
import {
  sanitizeLoggedUrl,
  ShareTokenSafeExceptionsFilter,
} from './share-tokens';

describe('sanitizeLoggedUrl', () => {
  it.each([
    ['/albums/shared/abc123', '/albums/shared/[REDACTED]'],
    [
      '/images/img-1?token=secret&width=800',
      '/images/img-1?token=%5BREDACTED%5D&width=800',
    ],
    ['/images/img-1?width=800', '/images/img-1?width=800'],
  ])('%s → %s', (url, expected) =>
    expect(sanitizeLoggedUrl(url)).toBe(expected),
  );
});

describe('ShareTokenSafeExceptionsFilter', () => {
  it('logs a rejected share link without its token and restores req.url', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const req = { method: 'GET', url: '/albums/shared/s3cret', id: 'r' };
    const res = {
      headersSent: false,
      statusCode: 200,
      setHeader: jest.fn(),
      getHeader: jest.fn(),
      end: jest.fn(),
    };
    const host = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ArgumentsHost;

    new ShareTokenSafeExceptionsFilter().catch(
      new ForbiddenException('Token expired'),
      host,
    );

    expect(res.statusCode).toBe(403);
    expect(warn).toHaveBeenCalledWith('403 GET /albums/shared/[REDACTED]');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('s3cret');
    expect(req.url).toBe('/albums/shared/s3cret');
    warn.mockRestore();
  });
});

describe('ShareTokenSafeExceptionsFilter http-errors', () => {
  const respond = (err: Error) => {
    const res = {
      headersSent: false,
      statusCode: 200,
      setHeader: jest.fn(),
      getHeader: jest.fn(),
      end: jest.fn(),
    };
    const host = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', url: '/albums' }),
        getResponse: () => res,
      }),
    } as unknown as ArgumentsHost;
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    new ShareTokenSafeExceptionsFilter().catch(err, host);
    return {
      status: res.statusCode,
      body: JSON.parse(res.end.mock.calls[0][0]),
    };
  };
  // What body-parser throws (http-errors): statusCode mirrors status.
  const httpError = (status: number, message: string, expose: boolean) =>
    Object.assign(new Error(message), { status, statusCode: status, expose });

  afterEach(() => jest.restoreAllMocks());

  it('keeps body-parser 413 as 413', () => {
    const { status, body } = respond(
      httpError(413, 'request entity too large', true),
    );
    expect(status).toBe(413);
    expect(body).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'request entity too large',
    });
  });

  it('hides the message of a non-exposed 4xx', () => {
    const { status, body } = respond(httpError(400, 'internal detail', false));
    expect(status).toBe(400);
    expect(body.message).toBe('Request failed');
  });

  it('leaves 5xx http-errors on the 500 branch', () => {
    expect(
      respond(httpError(500, 'stream.not.readable', false)).body.code,
    ).toBe('INTERNAL_ERROR');
  });

  it("does not adopt an upstream axios status as fileharbor's", () => {
    const axiosLike = Object.assign(new Error('Request failed'), {
      status: 404,
      response: {},
    });
    const { status, body } = respond(axiosLike);
    expect(status).toBe(500);
    expect(body.code).toBe('INTERNAL_ERROR');
  });
});
