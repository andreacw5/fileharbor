import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import V1Module from '../v1/v1.module';
import { AuthModule } from '../v1/auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import config from '../../configs/config.schema';
import { configValidationSchema } from '../../configs/config.validation';
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [config],
      isGlobal: true,
      cache: true,
      validationSchema: configValidationSchema,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport: {
          target: 'pino-pretty',
          options: {
            singleLine: true,
            levelFirst: true,
          },
        },
        autoLogging: false,
      },
    }),
    V1Module,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
