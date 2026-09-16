import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jose from 'jose';
import { BastionJwtPayload } from './bastion.types';

// Minimum interval between two refetches triggered by an unknown `kid`.
// Independent of BASTION_JWKS_TTL_MS: the TTL bounds *scheduled* refreshes,
// this bounds *reactive* ones. `kid` comes from an unverified token header,
// so it is attacker-controlled — without this cooldown a stream of forged
// tokens with random `kid`s would turn into a request amplifier pointed at
// Bastion's JWKS endpoint.
const UNKNOWN_KID_REFETCH_COOLDOWN_MS = 30_000;

/**
 * Verifies the RS256 signature of a Bastion token against Bastion's JWKS.
 *
 * Keys are cached **per `kid`**, not as a single PEM: Bastion publishes every
 * key it currently signs with, and during a rotation that is more than one.
 * Picking any single key out of the set would reject tokens signed with the
 * others for as long as the cache lives.
 */
@Injectable()
export class BastionJwksService {
  private readonly logger = new Logger(BastionJwksService.name);
  private cached = new Map<string, CryptoKey>();
  private cachedAt = 0;
  private lastUnknownKidRefetchAt = 0;

  constructor(private readonly config: ConfigService) {}

  private get ttl(): number {
    return this.config.get<number>('bastionJwksTtlMs') ?? 3_600_000;
  }

  private async fetchKeys(): Promise<void> {
    const url = `${this.config.get<string>('bastionUrl')}/.well-known/jwks.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const { keys } = (await res.json()) as { keys: jose.JWK[] };

    const next = new Map<string, CryptoKey>();
    for (const jwk of keys) {
      if (!jwk.kid) continue; // Bastion always sets kid; skip anything that doesn't
      next.set(jwk.kid, (await jose.importJWK(jwk, 'RS256')) as CryptoKey);
    }
    this.cached = next;
    this.cachedAt = Date.now();
  }

  private async ensureFresh(): Promise<void> {
    const stale = Date.now() - this.cachedAt >= this.ttl;
    if (!stale && this.cached.size) return;
    try {
      await this.fetchKeys();
    } catch (err) {
      if (this.cached.size) {
        this.logger.warn('JWKS fetch failed, serving stale cache');
        return;
      }
      throw err;
    }
  }

  // Refetches at most once per UNKNOWN_KID_REFETCH_COOLDOWN_MS in response to
  // a kid this cache doesn't have — this is what makes a rotation transparent
  // instead of a wait-out-the-TTL outage. The cooldown timestamp is consumed
  // even when the refetch fails, so a flood of unknown kids can't retry-storm
  // an already-failing Bastion; a failed refetch also leaves the existing
  // cache untouched (fetchKeys only swaps `this.cached` on success).
  private async refetchForUnknownKid(): Promise<void> {
    const now = Date.now();
    if (now - this.lastUnknownKidRefetchAt < UNKNOWN_KID_REFETCH_COOLDOWN_MS) {
      return;
    }
    this.lastUnknownKidRefetchAt = now;
    try {
      await this.fetchKeys();
    } catch (err) {
      this.logger.warn(
        `JWKS refetch for unknown kid failed: ${(err as Error).message}`,
      );
    }
  }

  async verify(token: string): Promise<BastionJwtPayload> {
    // Bastion sets `kid` on every token it signs. A token without one did
    // not come from a current Bastion — reject before touching the cache
    // or the network at all.
    //
    // decodeProtectedHeader throws on anything that isn't a well-formed JWS,
    // and the guards don't wrap verify(): unguarded, a garbage
    // `Authorization: Bearer abc` would surface as a 500 instead of a 401,
    // which is both wrong for the caller and noise in error monitoring.
    let kid: string | undefined;
    try {
      ({ kid } = jose.decodeProtectedHeader(token));
    } catch {
      this.logger.warn('JWT verification failed: malformed token header');
      throw new UnauthorizedException('Malformed token');
    }

    if (!kid) {
      this.logger.warn('JWT verification failed: missing kid in token header');
      throw new UnauthorizedException('Missing kid in JWT header');
    }

    await this.ensureFresh();

    let key = this.cached.get(kid);
    if (!key) {
      // Unknown kid: either a rotation this cache hasn't seen yet, or a
      // forged token. Refetch (subject to cooldown) and check again before
      // rejecting.
      await this.refetchForUnknownKid();
      key = this.cached.get(kid);
    }
    if (!key) {
      this.logger.warn(`JWT verification failed: unknown kid=${kid}`);
      throw new UnauthorizedException('Unknown or expired kid');
    }

    try {
      const { payload } = await jose.jwtVerify(token, key, {
        algorithms: ['RS256'],
      });
      return payload as unknown as BastionJwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
