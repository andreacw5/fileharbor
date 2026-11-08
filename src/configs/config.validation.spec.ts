import { validateConfig } from './config.validation';

const PROD = {
  NODE_ENV: 'production',
  CORS_ORIGIN: '*',
  TRUST_PROXY_HOPS: '1',
};

describe('validateConfig ENABLE_SWAGGER', () => {
  const swagger = (env: Record<string, string>) =>
    validateConfig({
      DATABASE_URL: 'postgresql://x',
      FILE_LINK_SECRET: 'x'.repeat(32),
      TINIFY_KEY_SECRET: 'a'.repeat(64),
      ...env,
    }).ENABLE_SWAGGER;

  it('is off when NODE_ENV is unset, although the schema defaults it', () => {
    expect(swagger({})).toBe('false');
  });

  it.each(['development', 'test'])('defaults on for NODE_ENV=%s', (env) => {
    expect(swagger({ NODE_ENV: env })).toBe('true');
  });

  it('defaults off in production', () => {
    expect(swagger(PROD)).toBe('false');
  });

  it('an explicit value wins', () => {
    expect(swagger({ ...PROD, ENABLE_SWAGGER: 'true' })).toBe('true');
    expect(swagger({ NODE_ENV: 'development', ENABLE_SWAGGER: 'false' })).toBe(
      'false',
    );
  });

  it('rejects anything but true/false', () => {
    expect(() => swagger({ ENABLE_SWAGGER: 'yes' })).toThrow(/ENABLE_SWAGGER/);
  });
});

describe('validateConfig TRUST_PROXY_HOPS', () => {
  const base = {
    DATABASE_URL: 'postgresql://x',
    FILE_LINK_SECRET: 'x'.repeat(32),
    TINIFY_KEY_SECRET: 'a'.repeat(64),
  };

  it('defaults to 0 outside production', () => {
    expect(validateConfig(base).TRUST_PROXY_HOPS).toBe(0);
  });

  it('is required in production', () => {
    const prod: Record<string, string> = { ...base, ...PROD };
    delete prod.TRUST_PROXY_HOPS;
    expect(() => validateConfig(prod)).toThrow(/TRUST_PROXY_HOPS/);
    expect(validateConfig({ ...base, ...PROD }).TRUST_PROXY_HOPS).toBe(1);
  });
});

describe('validateConfig FILE_LINK_SECRET', () => {
  it('is required, at least 32 chars', () => {
    const base = { DATABASE_URL: 'postgresql://x' };
    expect(() => validateConfig(base)).toThrow(/FILE_LINK_SECRET/);
    expect(() =>
      validateConfig({ ...base, FILE_LINK_SECRET: 'short' }),
    ).toThrow(/FILE_LINK_SECRET/);
  });
});
