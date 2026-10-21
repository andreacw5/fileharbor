import { BadRequestException } from '@nestjs/common';

/**
 * Reads a `true`/`false` query flag. Absent or empty means "no filter";
 * anything else is a 400 rather than a silently ignored typo.
 */
export function parseBooleanQuery(
  name: string,
  value?: string,
): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new BadRequestException(`${name} must be true or false`);
}
