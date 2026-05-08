/**
 * Time unit multipliers for converting to seconds
 */
const TIME_UNITS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

/**
 * Parse JWT expiresIn string to seconds
 * Supports formats: '15s', '15m', '2h', '7d'
 * @param value The expiresIn string (e.g., '15m', '2h', '7d')
 * @param defaultValue Fallback value in seconds if parsing fails
 * @returns Number of seconds
 */
export function parseExpiresInToSeconds(value: string, defaultValue: number = 900): number {
  const match = value.match(/^(\d+)([smhd])$/);

  if (!match) {
    return defaultValue;
  }

  const [, num, unit] = match;
  const multiplier = TIME_UNITS[unit];

  return parseInt(num, 10) * multiplier;
}

/**
 * Parse days from a number or compute from expiresIn string
 * @param value Number of days or expiresIn string
 * @param defaultDays Fallback value if parsing fails
 * @returns Number of days
 */
export function parseDays(value: number | string, defaultDays: number = 7): number {
  if (typeof value === 'number') {
    return value;
  }

  const seconds = parseExpiresInToSeconds(value, defaultDays * 86400);
  return Math.floor(seconds / 86400);
}

