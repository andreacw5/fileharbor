import * as process from 'node:process';

export default () => ({
  // Environment
  environment: process.env.NODE_ENV || 'development',

  // Server
  port: parseInt(process.env.PORT, 10) || 3000,
  apiPrefix: process.env.API_PREFIX ?? 'v2',
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',

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

  // Video Processing
  video: {
    maxVideoSize: parseInt(process.env.MAX_VIDEO_SIZE, 10) || 524288000,
    thumbnailQuality: parseInt(process.env.VIDEO_THUMBNAIL_QUALITY, 10) || 80,
    // Hand video delivery to nginx via X-Accel-Redirect instead of streaming it
    // from Node. Opt-in, and off by default: it only works behind an nginx that
    // declares the `/internal-videos/` internal location. Anywhere else the
    // response is headers with an empty body, and players report the file as an
    // unsupported format. This used to be keyed off NODE_ENV, which says nothing
    // about whether such an nginx is actually in front of the service.
    xAccelRedirect: process.env.VIDEO_X_ACCEL_REDIRECT === 'true',
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

  // Admin
  adminSecret: process.env.ADMIN_SECRET,

  // Bastion IdP
  bastionUrl: process.env.BASTION_URL || 'http://localhost:3001',
  bastionAppSlug: process.env.BASTION_APP_SLUG || 'fileharbor',
  bastionTenantSlug: process.env.BASTION_TENANT_SLUG || '',
  adminAcceptedAppSlugs: process.env.ADMIN_ACCEPTED_APP_SLUGS || '',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
});
