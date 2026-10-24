import { BadRequestException } from '@nestjs/common';
import {
  OPTIMIZE_GIVEN_UP_WHERE,
  OPTIMIZE_RETRYABLE_WHERE,
} from '@/modules/storage/storage.service';

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

// The optimize jobs' and gauges' own predicates: list and alert count the same rows.
const OPTIMIZE_STATUS_WHERE = {
  optimized: { isOptimized: true },
  pending: OPTIMIZE_RETRYABLE_WHERE,
  failed: OPTIMIZE_GIVEN_UP_WHERE,
} as const;

export const OPTIMIZE_STATUSES = Object.keys(OPTIMIZE_STATUS_WHERE);

/** Absent or empty → no filter; an unknown value is a 400, like parseBooleanQuery. */
export function parseOptimizeStatusQuery(value?: string) {
  if (value === undefined || value === '') return undefined;
  // Own keys only: 'constructor' must not resolve to Object
  if (!Object.prototype.hasOwnProperty.call(OPTIMIZE_STATUS_WHERE, value)) {
    throw new BadRequestException(
      'optimizeStatus must be optimized, pending or failed',
    );
  }
  return OPTIMIZE_STATUS_WHERE[value as keyof typeof OPTIMIZE_STATUS_WHERE];
}
