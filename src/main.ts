import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app/app.module';
import {HttpExceptionFilter} from "./filters/http-exception.filter";
import {Logger} from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const appOptions = { cors: true };
  const app = await NestFactory.create(AppModule, appOptions);

  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('api');

  // Swagger setup
  const options = new DocumentBuilder()
      .setTitle('Image Uploader API')
      .setDescription('Image updloader service')
      .setVersion('1.0')
      .build();
  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('/docs', app, document);

  await app.listen(3000);
}
bootstrap().then(r => {
  Logger.log('Swagger available at: http://localhost:' + 3000 + '/docs');
  Logger.log('App is running and is listening at: http://localhost:' + 3000 + '/api/v1/status');
});
