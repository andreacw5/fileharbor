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
