import * as Joi from 'joi';

export const configValidationSchema = Joi.object({
  // Environment
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),

  // Server
  PORT: Joi.number().positive().default(3000),
  API_PREFIX: Joi.string().default('v2'),

  // Database
  DATABASE_URL: Joi.string().required(),

  // Storage
  STORAGE_PATH: Joi.string().default('./storage'),
  MAX_FILE_SIZE: Joi.number().positive().default(10485760),
  ALLOWED_IMAGE_TYPES: Joi.string().default('image/jpeg,image/png,image/webp,image/gif'),

  // Image Processing
  THUMBNAIL_SIZE: Joi.number().positive().default(800),
  ORIGINAL_QUALITY: Joi.number().min(1).max(100).default(100),
  THUMBNAIL_QUALITY: Joi.number().min(1).max(100).default(70),
  COMPRESSION_QUALITY: Joi.number().min(1).max(100).default(90),

  // Rate Limiting
  THROTTLE_TTL: Joi.number().positive().default(60),
  THROTTLE_LIMIT: Joi.number().positive().default(10),

  // Logging
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug', 'verbose').default('info'),
});
