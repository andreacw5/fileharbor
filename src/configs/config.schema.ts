import * as process from 'node:process';

export default () => ({
  // Server
  apiPrefix: process.env.API_PREFIX ?? 'v2',
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  metricsPort: parseInt(process.env.METRICS_PORT, 10) || 9091,

  image: {
    // Same contract as video.xAccelRedirect: opt-in, and only behind an nginx
    // declaring an internal `/internal-images/` location aliased to STORAGE_PATH.
    // Without one the response is headers with an empty body.
    xAccelRedirect: process.env.IMAGE_X_ACCEL_REDIRECT === 'true',
  },

  // Video Processing
  video: {
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
    limit: parseInt(process.env.THROTTLE_LIMIT, 10) || 10, // requests per TTL
  },

  // Bastion IdP
  bastionUrl: process.env.BASTION_URL || 'http://localhost:3001',
  bastionAppSlug: process.env.BASTION_APP_SLUG || 'fileharbor',
  adminAcceptedAppSlugs: process.env.ADMIN_ACCEPTED_APP_SLUGS || '',
  // Service-client credentials, used only for outgoing calls (audit events).
  bastionClientApiKey: process.env.BASTION_CLIENT_API_KEY || '',
  bastionTenantSlug: process.env.BASTION_TENANT_SLUG || '',
  bastionJwksTtlMs: parseInt(process.env.BASTION_JWKS_TTL_MS || '300000', 10),
});
