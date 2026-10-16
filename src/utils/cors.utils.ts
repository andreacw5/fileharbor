/**
 * Parses CORS_ORIGIN (`*` or a comma-separated origin list) into what
 * `enableCors({ origin })` takes. Shared by the Joi rule and `main.ts`, so a
 * value that boots is a value that works.
 *
 * Empty entries are dropped and a trailing `/` stripped: browsers send
 * `Origin` without one, so `https://a.com/` would never match.
 * `*` inside a list is rejected — the cors package compares it literally,
 * so it would allow nothing rather than everything.
 */
export function parseCorsOrigin(value: string): '*' | string[] {
  const origins = value
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  if (origins.length === 1 && origins[0] === '*') return '*';
  if (origins.includes('*')) {
    throw new Error('CORS_ORIGIN: `*` cannot be mixed with other origins');
  }
  if (origins.length === 0) {
    throw new Error('CORS_ORIGIN: no origin given');
  }
  return origins;
}
