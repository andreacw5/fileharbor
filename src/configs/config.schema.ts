import Joi from 'joi';

export default () => ({
    port: parseInt(process.env.APP_PORT) || 3000,
    database: process.env.DATABASE_URL,
    cache: {
        ttl: parseInt(process.env.CACHE_TTL) || 60,
    },
    auth: {
        key: process.env.API_KEY,
    },
});
