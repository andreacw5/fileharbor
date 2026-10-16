import { sanitizeLoggedUrl } from './share-tokens';

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
