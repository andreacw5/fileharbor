import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import V1Module from '../v1/v1.module';
import { AuthModule } from '../v1/auth/auth.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import config from '../../configs/config.schema';
import { configValidationSchema } from '../../configs/config.validation';
import { LoggerModule } from 'nestjs-pino';
import { CacheModule } from '@nestjs/cache-manager';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [config],
      isGlobal: true,
      cache: true,
      validationSchema: configValidationSchema,
    }),
    CacheModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        ttl: configService.get('CACHE_TTL'),
      }),
      inject: [ConfigService],
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const logtailTarget = configService.get('LOGS_TOKEN')
          ? {
              target: '@logtail/pino',
              options: { sourceToken: configService.get('LOGS_TOKEN') },
            }
          : null;

        const targets = [
          {
            target: 'pino-pretty',
          },
        ];

        if (logtailTarget) {
          targets.push(logtailTarget);
        }

        return {
          pinoHttp: {
            transport: {
              targets,
              options: {
                singleLine: true,
                levelFirst: true,
              },
            },
            autoLogging: false,
          },
        };
      },
      inject: [ConfigService],
    }),
    V1Module,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
