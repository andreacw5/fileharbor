import * as process from 'node:process';

export default () => ({
  database: process.env.DATABASE_URL,
  logging: {
    level: process.env.LOG_LEVEL || 'info', // debug, info, warn, error
    enableAuthDebug: process.env.ENABLE_AUTH_DEBUG === 'true'
  },
});
