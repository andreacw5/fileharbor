import Joi from 'joi';

export const configValidationSchema = Joi.object({
  APP_PORT: Joi.number().default(3000).required(),
  DATABASE_URL: Joi.string().required(),
  CACHE_TTL: Joi.number().default(60).required(),
  API_KEY: Joi.string().required(),
});
