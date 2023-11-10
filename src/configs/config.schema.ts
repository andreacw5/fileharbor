import Joi from 'joi';

export const configValidationSchema = Joi.object({
    APP_PORT: Joi.number().default(8080).required(),
    DATABASE_URL: Joi.string().required(),
});
