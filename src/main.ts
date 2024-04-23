import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app/app.module';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { json } from 'express';

async function bootstrap() {
  const appOptions = { cors: true };
  const app = await NestFactory.create(AppModule, appOptions);

  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('api');

  app.use(json({ limit: '5mb' }));

  const configService = app.get(ConfigService);

  // Swagger setup
  const options = new DocumentBuilder()
    .setTitle('Image Uploader API')
    .setDescription('Image updloader service')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('/docs', app, document);

  const appPort = configService.get<number>('APP_PORT', 3000);
  await app.listen(appPort);

  Logger.log('Swagger available at: http://localhost:' + appPort + '/docs');
  Logger.log('Listening at: http://localhost:' + appPort + '/api/v1/status');

  // Log all environment variables
  Logger.debug('Configured environment variables:', {
    url: configService.get('url'),
    port: configService.get('port'),
    ttl: configService.get('cache.ttl'),
  });
}
bootstrap().then(() => {
  Logger.log('App running now!');
});
