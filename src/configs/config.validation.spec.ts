import { validateConfig } from './config.validation';

describe('validateConfig ENABLE_SWAGGER', () => {
  const swagger = (env: Record<string, string>) =>
    validateConfig({ DATABASE_URL: 'postgresql://x', ...env }).ENABLE_SWAGGER;

  it('is off when NODE_ENV is unset, although the schema defaults it', () => {
    expect(swagger({})).toBe('false');
  });

  it.each(['development', 'test'])('defaults on for NODE_ENV=%s', (env) => {
    expect(swagger({ NODE_ENV: env })).toBe('true');
  });

  it('defaults off in production', () => {
    expect(swagger({ NODE_ENV: 'production', CORS_ORIGIN: '*' })).toBe(
      'false',
    );
  });

  it('an explicit value wins', () => {
    expect(
      swagger({ NODE_ENV: 'production', CORS_ORIGIN: '*', ENABLE_SWAGGER: 'true' }),
    ).toBe('true');
    expect(swagger({ NODE_ENV: 'development', ENABLE_SWAGGER: 'false' })).toBe(
      'false',
    );
  });

  it('rejects anything but true/false', () => {
    expect(() => swagger({ ENABLE_SWAGGER: 'yes' })).toThrow(/ENABLE_SWAGGER/);
  });
});
