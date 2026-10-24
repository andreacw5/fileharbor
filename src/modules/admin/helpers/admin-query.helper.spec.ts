import { BadRequestException } from '@nestjs/common';
import {
  parseBooleanQuery,
  parseOptimizeStatusQuery,
} from './admin-query.helper';
import {
  OPTIMIZE_GIVEN_UP_WHERE,
  OPTIMIZE_RETRYABLE_WHERE,
} from '@/modules/storage/storage.service';

describe('parseBooleanQuery', () => {
  it('reads true and false', () => {
    expect(parseBooleanQuery('isPrivate', 'true')).toBe(true);
    expect(parseBooleanQuery('isPrivate', 'false')).toBe(false);
  });

  it('treats absent or empty as no filter', () => {
    expect(parseBooleanQuery('isPrivate', undefined)).toBeUndefined();
    expect(parseBooleanQuery('isPrivate', '')).toBeUndefined();
  });

  it('rejects anything else', () => {
    expect(() => parseBooleanQuery('isPrivate', '1')).toThrow(
      BadRequestException,
    );
    expect(() => parseBooleanQuery('isPrivate', 'TRUE')).toThrow(
      'isPrivate must be true or false',
    );
  });
});

describe('parseOptimizeStatusQuery', () => {
  it('treats absent or empty as no filter', () => {
    expect(parseOptimizeStatusQuery(undefined)).toBeUndefined();
    expect(parseOptimizeStatusQuery('')).toBeUndefined();
  });

  it("maps onto the optimize job's own predicates", () => {
    expect(parseOptimizeStatusQuery('optimized')).toEqual({
      isOptimized: true,
    });
    expect(parseOptimizeStatusQuery('pending')).toBe(OPTIMIZE_RETRYABLE_WHERE);
    expect(parseOptimizeStatusQuery('failed')).toBe(OPTIMIZE_GIVEN_UP_WHERE);
  });

  it.each(['FAILED', 'done', 'constructor'])('rejects %s', (value) => {
    expect(() => parseOptimizeStatusQuery(value)).toThrow(
      'optimizeStatus must be optimized, pending or failed',
    );
  });
});
