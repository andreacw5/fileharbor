import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './modules/app/app.module';
import { HttpExceptionFilter } from '@/filters/http-exception.filter';
import { json } from 'express';

async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule, {
      bufferLogs: true,
      logger: ['log', 'error', 'warn', 'debug', 'verbose'],
    });

    // Global validation pipe
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    // Enable CORS
    app.enableCors({
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-API-Key', 'X-User-Id'],
      credentials: true,
    });

    // Use global exception filter
    app.useGlobalFilters(new HttpExceptionFilter());

    app.use(json({ limit: '5mb' }));

    const productionPath = process.env.NODE_ENV === 'develop' ? '' : '/v2';

    // Swagger documentation
    const config = new DocumentBuilder()
      .setTitle('FileHarbor 2.0')
      .setDescription('Multi-tenant image management system API')
      .setVersion(process?.env?.npm_package_version || '2.0.0')
      .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
      .setBasePath(productionPath)
      .setLicense(
        'MIT',
        'https://github.com/heyatomdev/fileharbor/blob/main/README.md',
      )
      .setContact('Andrea Tombolato', 'https://heyatom.dev', 'hey@heyatom.dev')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('/docs', app, document);

    const port = process.env.PORT || 3000;
    await app.listen(port);

    const logger = new Logger('Bootstrap');
    logger.log(`🚀 FileHarbor started successfully!`);
    logger.log(`📚 API Documentation: http://localhost:${port}/docs`);
    logger.log(`📈 Metrics endpoint: http://localhost:${port}/metrics`);
    logger.log(`📝 Logging enabled for: log, error, warn, debug, verbose`);

  } catch (error) {

    Logger.error('❌ Failed to start the application', 'Bootstrap');

    if (error.message.includes('Database connection failed')) {
      Logger.error('Database connection issue detected', 'Bootstrap');
    } else if (error.message.includes('EADDRINUSE')) {
      Logger.error(`Port is already in use. Another service might be running on the same port`, 'Bootstrap');
    } else if (error.message.includes('EACCES')) {
      Logger.error(`Permission denied. You might not have permission to bind to this port`, 'Bootstrap');
    } else {
      Logger.error(`Unexpected error: ${error.message}`, 'Bootstrap');
    }

    Logger.error('Stack trace:', error.stack, 'Bootstrap');
    throw error;
  }
}

bootstrap()
  .then((app) => {
    Logger.log('🎉 App running now!', 'Bootstrap');
  })
  .catch((error) => {
    Logger.error('💥 Critical error during application startup:', 'Bootstrap');
    Logger.error(error.message, 'Bootstrap');
    Logger.error('🔄 Please fix the issues above and try again', 'Bootstrap');
    process.exit(1);
  });
