import { BadRequestException } from '@nestjs/common';
import { parseBooleanQuery } from './admin-query.helper';

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
