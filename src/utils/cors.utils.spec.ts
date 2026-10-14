import { parseCorsOrigin } from './cors.utils';
import { configValidationSchema } from '@/configs/config.validation';

describe('parseCorsOrigin', () => {
  it('keeps a lone `*` as the wildcard', () => {
    expect(parseCorsOrigin('*')).toBe('*');
    expect(parseCorsOrigin(' * ')).toBe('*');
  });

  it('trims entries, drops empty ones and strips trailing slashes', () => {
    expect(parseCorsOrigin(' https://a.com/, ,https://b.com,')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('rejects `*` mixed into a list', () => {
    expect(() => parseCorsOrigin('https://a.com,*')).toThrow();
  });

  it('rejects a list with no origin in it', () => {
    expect(() => parseCorsOrigin(' , ')).toThrow();
  });
});

describe('CORS_ORIGIN validation', () => {
  const validate = (env: Record<string, string>) =>
    configValidationSchema.validate(
      { DATABASE_URL: 'postgresql://x', ...env },
      { allowUnknown: true },
    );

  it('treats an empty value as unset outside production', () => {
    const { error, value } = validate({ CORS_ORIGIN: '' });
    expect(error).toBeUndefined();
    expect(value.CORS_ORIGIN).toBe('*');
  });

  it('still requires a value in production', () => {
    const { error } = validate({ NODE_ENV: 'production', CORS_ORIGIN: '' });
    expect(error?.message).toMatch(/CORS_ORIGIN/);
  });

  it('fails boot on `*` mixed into a list', () => {
    const { error } = validate({ CORS_ORIGIN: 'https://a.com,*' });
    expect(error?.message).toMatch(/cannot be mixed/);
  });
});
