import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app/app.module';
import {HttpExceptionFilter} from "./filters/http-exception.filter";
import {Logger} from "@nestjs/common";

async function bootstrap() {
  const appOptions = { cors: true };
  const app = await NestFactory.create(AppModule, appOptions);

  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('api');

  await app.listen(3000);
}
bootstrap().then(r => {
  Logger.log('App is running and is listening at: http://localhost:' + 3000 + '/api/');
});
