import * as process from 'node:process';

export default () => ({
  // Environment
  environment: process.env.NODE_ENV || 'development',

  // Server
  port: parseInt(process.env.PORT, 10) || 3000,
  apiPrefix: process.env.API_PREFIX || 'v2',

  // Database
  database: process.env.DATABASE_URL,

  // Storage
  storage: {
    path: process.env.STORAGE_PATH || './storage',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 10485760, // 10MB
    allowedImageTypes: process.env.ALLOWED_IMAGE_TYPES?.split(',') || ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  },

  // Image Processing
  imageProcessing: {
    thumbnailSize: parseInt(process.env.THUMBNAIL_SIZE, 10) || 800,
    originalQuality: parseInt(process.env.ORIGINAL_QUALITY, 10) || 100,
    thumbnailQuality: parseInt(process.env.THUMBNAIL_QUALITY, 10) || 70,
    compressionQuality: parseInt(process.env.COMPRESSION_QUALITY, 10) || 90
  },

  // Rate Limiting
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL, 10) || 60, // seconds
    limit: parseInt(process.env.THROTTLE_LIMIT, 10) || 10 // requests per TTL
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info', // debug, info, warn, error
  },
});
