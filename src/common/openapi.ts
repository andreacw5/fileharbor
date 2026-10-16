import type { SwaggerOptions } from '@heyatom/nest-common';
import { APP_VERSION } from './version';

/** Shared by `setupSwagger` (main.ts) and `scripts/openapi-dump.ts`. */
export const SWAGGER_OPTIONS: SwaggerOptions = {
  title: 'FileHarbor 2.0',
  version: APP_VERSION,
  description: 'Multi-tenant image management system API',
  configure: (b) =>
    b
      .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
      .addBearerAuth()
      .setLicense(
        'MIT',
        'https://github.com/heyatomdev/fileharbor/blob/main/README.md',
      )
      .setContact('Andrea Tombolato', 'https://heyatom.dev', 'hey@heyatom.dev'),
};
