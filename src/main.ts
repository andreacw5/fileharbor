import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './modules/app/app.module';
import { setupHttpApp, setupSwagger } from '@heyatom/nest-common';
import { SWAGGER_OPTIONS } from '@/common/openapi';
import { parseCorsOrigin } from '@/utils/cors.utils';

async function bootstrap() {
  try {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
      bufferLogs: true,
    });
    app.useLogger(app.get(PinoLogger));

    // Defaults live in config.validation.ts — single source of truth.
    const config = app.get(ConfigService);
    const port = config.getOrThrow<number>('PORT');

    // CORS_ORIGIN: `*` or an origin list, validated at boot (required in production).
    const corsOrigin = parseCorsOrigin(
      config.getOrThrow<string>('CORS_ORIGIN'),
    );
    // CDN: other sites embed our images and videos, so CORP must be cross-origin.
    // Over plain http (LAN IP) `upgrade-insecure-requests` would break /docs.
    const production = config.get<string>('NODE_ENV') === 'production';

    // Shutdown hooks, trust proxy, helmet, CORS, JSON body limit,
    // global ValidationPipe (whitelist, forbidNonWhitelisted, transform).
    setupHttpApp(app, {
      trustProxyHops: config.getOrThrow<number>('TRUST_PROXY_HOPS'),
      corsOrigins: corsOrigin,
      corsAllowedHeaders: ['X-API-Key', 'X-User-Id'],
      jsonBodyLimit: '5mb',
      helmet: {
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        ...(production
          ? {}
          : {
              contentSecurityPolicy: {
                directives: { upgradeInsecureRequests: null },
              },
            }),
      },
    });

    // Same value RouteHelperService builds URLs from: served routes and returned
    // URLs always agree. Probes stay at /health/* whatever the prefix.
    const apiPrefix = config.get<string>('apiPrefix') ?? '';
    if (apiPrefix) {
      app.setGlobalPrefix(apiPrefix, {
        exclude: ['health/live', 'health/ready'],
      });
    }
    // /docs enumerates the whole API surface, admin routes included. Resolved once
    // in validateConfig: explicit ENABLE_SWAGGER, else development/test only.
    const swagger = config.get<string>('ENABLE_SWAGGER') === 'true';
    if (swagger) setupSwagger(app, SWAGGER_OPTIONS);

    await app.listen(port);

    const logger = new Logger('Bootstrap');
    logger.log(`FileHarbor started successfully!`);
    if (swagger) {
      logger.log(`API Documentation: http://localhost:${port}/docs`);
    }
    logger.log(`Current BASE_URL is set to: ${config.get<string>('BASE_URL')}`);
  } catch (error) {
    Logger.error('Failed to start the application', 'Bootstrap');

    if (error.message.includes('Database connection failed')) {
      Logger.error('Database connection issue detected', 'Bootstrap');
    } else if (error.message.includes('EADDRINUSE')) {
      Logger.error(
        `Port is already in use. Another service might be running on the same port`,
        'Bootstrap',
      );
    } else if (error.message.includes('EACCES')) {
      Logger.error(
        `Permission denied. You might not have permission to bind to this port`,
        'Bootstrap',
      );
    } else {
      Logger.error(`Unexpected error: ${error.message}`, 'Bootstrap');
    }

    Logger.error('Stack trace:', error.stack, 'Bootstrap');
    throw error;
  }
}

bootstrap()
  .then(() => {
    Logger.log('App running now!', 'Bootstrap');
  })
  .catch((error) => {
    Logger.error('Critical error during application startup:', 'Bootstrap');
    Logger.error(error.message, 'Bootstrap');
    Logger.error('Please fix the issues above and try again', 'Bootstrap');
    process.exit(1);
  });
