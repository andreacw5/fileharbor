import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './modules/app/app.module';
import { json } from 'express';
import { setupSwagger } from '@heyatom/nest-common';
import { SWAGGER_OPTIONS } from '@/common/openapi';
import { parseCorsOrigin } from '@/utils/cors.utils';

async function bootstrap() {
  try {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
      bufferLogs: true,
    });
    // One proxy hop (nginx): req.ip is the client, so the throttler keys on it
    // rather than on the proxy's address.
    app.set('trust proxy', 1);
    app.useLogger(app.get(PinoLogger));

    // Global validation pipe
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    const config = app.get(ConfigService);

    // Enable CORS. CORS_ORIGIN is validated at boot (required in production).
    const corsOrigin = config.get<string>('CORS_ORIGIN', '*');
    app.enableCors({
      origin: parseCorsOrigin(corsOrigin),
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: [
        'Content-Type',
        'X-API-Key',
        'X-User-Id',
        'Authorization',
      ],
    });

    app.use(json({ limit: '5mb' }));

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

    const port = process.env.PORT || 8081;
    await app.listen(port);

    const logger = new Logger('Bootstrap');
    logger.log(`FileHarbor started successfully!`);
    if (swagger) {
      logger.log(`API Documentation: http://localhost:${port}/docs`);
    }
    logger.log(
      `Current BASE_URL is set to: ${process.env.BASE_URL || 'Not Set'}`,
    );
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
