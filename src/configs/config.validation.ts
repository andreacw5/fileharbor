import * as Joi from 'joi';
import { swaggerEnabled } from '@heyatom/nest-common';
import { parseCorsOrigin } from '@/utils/cors.utils';

export const configValidationSchema = Joi.object({
  // Environment
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  // Server
  PORT: Joi.number().positive().default(3000),
  API_PREFIX: Joi.string().allow('').default(''),
  // Swagger UI on /docs. Unset → on only when NODE_ENV is explicitly
  // development/test; resolved in validateConfig() from the raw NODE_ENV.
  ENABLE_SWAGGER: Joi.string().valid('true', 'false').empty(''),
  BASE_URL: Joi.string().uri().default('http://localhost:3000'),
  // X-Forwarded-For hops trusted for req.ip, which the throttler keys on:
  // 0 = the socket peer, 1 = behind one nginx. Required in production: a
  // forgotten 0 behind nginx would put every client in the proxy's bucket.
  TRUST_PROXY_HOPS: Joi.number()
    .integer()
    .min(0)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.optional().default(0),
    }),
  // Prometheus scrape port — internal network only, never published or proxied.
  METRICS_PORT: Joi.number().port().default(9091),
  // `*` or a comma-separated list of origins. Required in production: a
  // forgotten variable must not silently open the API to every origin.
  // An empty value counts as unset.
  CORS_ORIGIN: Joi.string()
    .empty('')
    .custom((value: string, helpers) => {
      try {
        parseCorsOrigin(value);
        return value;
      } catch (error) {
        return helpers.message({ custom: (error as Error).message });
      }
    })
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.optional().default('*'),
    }),

  // Database
  DATABASE_URL: Joi.string().required(),
  DATABASE_POOL_MAX: Joi.number().integer().min(1).default(20),

  // Storage
  STORAGE_PATH: Joi.string().default('./storage'),
  MAX_FILE_SIZE: Joi.number().positive().default(10485760),
  // /health/ready reports down below this much free space on STORAGE_PATH.
  HEALTH_DISK_MIN_FREE_MB: Joi.number().integer().min(0).default(1024),

  // Image Processing
  THUMBNAIL_SIZE: Joi.number().positive().default(800),
  ORIGINAL_QUALITY: Joi.number().min(1).max(100).default(100),
  OPTIMIZE_QUALITY: Joi.number().min(1).max(100).default(85),
  THUMBNAIL_QUALITY: Joi.number().min(1).max(100).default(70),
  // On-demand renders (GET /images/:id resizes, avatar format conversion) run
  // at most this many at once; up to RENDER_QUEUE_LIMIT more wait, the rest 503.
  RENDER_CONCURRENCY: Joi.number().integer().min(1).default(2),
  RENDER_QUEUE_LIMIT: Joi.number().integer().min(0).default(20),
  // TinifyAutoJob: images compressed per client per hourly run, so the monthly quota lasts
  TINIFY_AUTO_BATCH: Joi.number().integer().min(1).default(20),

  // Rate Limiting
  THROTTLE_TTL: Joi.number().positive().default(60),
  THROTTLE_LIMIT: Joi.number().positive().default(10),

  // Logging
  // pino levels; unset → debug in development, info in production
  LOG_LEVEL: Joi.string().valid(
    'fatal',
    'error',
    'warn',
    'info',
    'debug',
    'trace',
  ),

  // Video Processing
  MAX_VIDEO_SIZE: Joi.number().positive().default(524288000),
  VIDEO_THUMBNAIL_QUALITY: Joi.number().min(1).max(100).default(80),
  // Only enable behind an nginx that serves the `/internal-videos/` internal
  // location; otherwise video responses come back empty.
  VIDEO_X_ACCEL_REDIRECT: Joi.boolean().default(false),
  IMAGE_X_ACCEL_REDIRECT: Joi.boolean().default(false),

  // Bastion IdP
  BASTION_URL: Joi.string().uri().default('http://localhost:3001'),
  BASTION_APP_SLUG: Joi.string().default('fileharbor'),
  // Comma-separated app slugs accepted by BastionUserGuard. Empty falls back to BASTION_APP_SLUG.
  ADMIN_ACCEPTED_APP_SLUGS: Joi.string().allow('').default(''),
  // Service-client key used to write audit events to Bastion. Optional: without
  // it the service starts normally and audit writes are skipped with a warning,
  // rather than every admin action failing on a missing credential.
  BASTION_CLIENT_API_KEY: Joi.string().allow('').default(''),
  // Only set when the service client is bound to a single Bastion tenant.
  BASTION_TENANT_SLUG: Joi.string().allow('').default(''),
  BASTION_JWKS_TTL_MS: Joi.number().default(300000),
});

/**
 * `ConfigModule` `validate`: the Joi schema, plus `ENABLE_SWAGGER` resolved once
 * (api.md §4). It reads the **raw** `NODE_ENV`: the schema defaults it to
 * `development`, which would turn Swagger on wherever `NODE_ENV` is unset.
 */
export function validateConfig(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const { error, value } = configValidationSchema.validate(raw, {
    allowUnknown: true,
    abortEarly: false,
  });
  if (error) throw new Error(`Config validation error: ${error.message}`);
  return {
    ...value,
    ENABLE_SWAGGER: String(
      swaggerEnabled({
        ENABLE_SWAGGER: value.ENABLE_SWAGGER,
        NODE_ENV: raw.NODE_ENV as string | undefined,
      }),
    ),
  };
}
