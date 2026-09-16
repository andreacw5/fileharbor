import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BastionJwksService } from './bastion-jwks.service';

jest.mock('jose', () => ({
  importJWK: jest.fn((jwk) => Promise.resolve(jwk)),
  jwtVerify: jest.fn(),
  decodeProtectedHeader: jest.fn(),
}));

import { decodeProtectedHeader, jwtVerify } from 'jose';

const mockConfig = (overrides: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = {
    bastionUrl: 'https://bastion',
    bastionJwksTtlMs: 300_000,
    ...overrides,
  };
  return {
    getOrThrow: (k: string) => values[k],
    get: (k: string) => values[k],
  } as unknown as ConfigService;
};

const jwkA = { kty: 'RSA', n: 'a', e: 'AQAB', kid: 'kid-a' };
const jwkB = { kty: 'RSA', n: 'b', e: 'AQAB', kid: 'kid-b' };

function mockFetch(keys: object[], ok = true) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve({ keys }),
  } as any);
}

describe('BastionJwksService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (decodeProtectedHeader as jest.Mock).mockReturnValue({ kid: 'kid-a' });
    (jwtVerify as jest.Mock).mockResolvedValue({
      payload: { sub: '1', type: 'service_client' },
    });
  });

  it('verifies without any fetch when the kid is already cached', async () => {
    mockFetch([jwkA]);
    const svc = new BastionJwksService(mockConfig());
    await svc.verify('tok');
    await svc.verify('tok');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('triggers exactly one refetch on an unknown kid and verifies if the new key set has it', async () => {
    mockFetch([jwkA]);
    const svc = new BastionJwksService(mockConfig());
    await svc.verify('tok'); // warms cache with kid-a only, 1 fetch so far

    (decodeProtectedHeader as jest.Mock).mockReturnValue({ kid: 'kid-b' });
    mockFetch([jwkA, jwkB]); // simulate rotation: kid-b now published

    const result = await svc.verify('tok-b');

    expect(global.fetch).toHaveBeenCalledTimes(1); // the refetch triggered by the unknown kid
    expect(result).toEqual({ sub: '1', type: 'service_client' });
  });

  it('throws UnauthorizedException when the kid is still unknown after the refetch', async () => {
    mockFetch([jwkA]);
    const svc = new BastionJwksService(mockConfig());
    await svc.verify('tok'); // warms cache with kid-a only

    (decodeProtectedHeader as jest.Mock).mockReturnValue({
      kid: 'kid-missing',
    });
    mockFetch([jwkA]); // refetch still doesn't contain kid-missing

    await expect(svc.verify('bad-tok')).rejects.toThrow(UnauthorizedException);
  });

  it('holds the cooldown: a burst of unknown kids triggers at most one refetch within the window', async () => {
    mockFetch([jwkA]);
    const svc = new BastionJwksService(mockConfig());
    await svc.verify('tok'); // warms cache, 1 fetch

    (decodeProtectedHeader as jest.Mock).mockReturnValue({
      kid: 'kid-missing',
    });
    mockFetch([jwkA]);

    await svc.verify('t1').catch(() => {});
    await svc.verify('t2').catch(() => {});
    await svc.verify('t3').catch(() => {});

    // only the first of the burst should have triggered a refetch
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a token with no kid without ever fetching', async () => {
    (decodeProtectedHeader as jest.Mock).mockReturnValue({});
    const svc = new BastionJwksService(mockConfig());

    await expect(svc.verify('no-kid-tok')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // A garbage Authorization header used to reach decodeProtectedHeader
  // unguarded and throw a raw jose error; neither guard wraps verify(), so it
  // surfaced as a 500. A malformed token is a client error, not a server one.
  it('rejects a malformed token with 401, not a raw error, and never fetches', async () => {
    (decodeProtectedHeader as jest.Mock).mockImplementation(() => {
      throw new Error('Invalid Compact JWS');
    });
    const svc = new BastionJwksService(mockConfig());

    await expect(svc.verify('not-a-jwt')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('keeps serving the existing cache when a scheduled refetch fails', async () => {
    jest.useFakeTimers();
    mockFetch([jwkA]);
    const svc = new BastionJwksService(mockConfig({ bastionJwksTtlMs: 100 }));
    await svc.verify('tok'); // warms cache

    jest.advanceTimersByTime(200); // TTL expires
    mockFetch([], false); // Bastion unreachable

    const result = await svc.verify('tok'); // should fall back to the stale cache
    expect(result).toEqual({ sub: '1', type: 'service_client' });
    jest.useRealTimers();
  });

  it('leaves a working cache intact when a kid-triggered refetch itself fails, and still consumes the cooldown', async () => {
    mockFetch([jwkA]);
    const svc = new BastionJwksService(mockConfig());
    await svc.verify('tok'); // warms cache with kid-a, 1 fetch

    (decodeProtectedHeader as jest.Mock).mockReturnValue({
      kid: 'kid-missing',
    });
    mockFetch([], false); // Bastion unreachable for the kid-triggered refetch

    await expect(svc.verify('bad-tok')).rejects.toThrow(UnauthorizedException);
    expect(global.fetch).toHaveBeenCalledTimes(1); // the failed kid-triggered refetch

    // cooldown was consumed even though the refetch failed — a second unknown
    // kid right after must not trigger yet another fetch
    await expect(svc.verify('bad-tok-2')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // the original cache (kid-a) is still intact and serving
    (decodeProtectedHeader as jest.Mock).mockReturnValue({ kid: 'kid-a' });
    const result = await svc.verify('tok');
    expect(result).toEqual({ sub: '1', type: 'service_client' });
    expect(global.fetch).toHaveBeenCalledTimes(1); // no extra fetch — kid-a still cached
  });
});
