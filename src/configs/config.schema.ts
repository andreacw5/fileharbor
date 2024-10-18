export default () => ({
  port: parseInt(process.env.APP_PORT) || 3000,
  url: process.env.APP_URL,
  database: process.env.DATABASE_URL,
  cache: {
    ttl: parseInt(process.env.CACHE_TTL) || 60,
  },
  uptime: {
    logsToken: process.env.LOGS_TOKEN,
  },
  auth: {
    key: process.env.API_KEY,
  },
});
