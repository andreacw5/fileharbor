import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import V1Module from '../v1/v1.module';
import { AuthModule } from '../v1/auth/auth.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        pinoHttp: {
          transport: {
            targets: [
              {
                target: '@logtail/pino',
                options: { sourceToken: configService.get('LOGS_TOKEN') },
              },
              {
                target: 'pino-pretty',
              },
            ],
            options: {
              singleLine: true,
            },
          },
        },
      }),
      inject: [ConfigService],
    }),
    V1Module,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
