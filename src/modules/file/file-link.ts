import { createHmac, timingSafeEqual } from 'crypto';

/** How long a signed download link lives (plan 12 §5bis). */
export const FILE_LINK_TTL_SECONDS = 600;

const sign = (fileId: string, exp: number, secret: string) =>
  createHmac('sha256', secret).update(`${fileId}.${exp}`).digest('base64url');

/**
 * `<exp>.<sig>`: exp in epoch seconds, sig = HMAC-SHA256 of `${fileId}.${exp}`.
 * Bound to one file and stateless: no table, nothing to clean up. Rotating the
 * secret kills only the links in flight.
 */
export function signFileLink(
  fileId: string,
  secret: string,
  now = Date.now(),
): { token: string; expiresAt: Date } {
  const exp = Math.floor(now / 1000) + FILE_LINK_TTL_SECONDS;
  return {
    token: `${exp}.${sign(fileId, exp, secret)}`,
    expiresAt: new Date(exp * 1000),
  };
}

/** Malformed, expired or forged → false, never a throw. */
export function verifyFileLink(
  fileId: string,
  token: string | undefined,
  secret: string,
  now = Date.now(),
): boolean {
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]+)$/.exec(token ?? '');
  if (!match) return false;
  const exp = Number(match[1]);
  if (exp * 1000 <= now) return false;
  const given = Buffer.from(match[2]);
  const expected = Buffer.from(sign(fileId, exp, secret));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
