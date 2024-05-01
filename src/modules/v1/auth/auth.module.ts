import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { HeaderApiKeyStrategy } from './key.strategy';
import { ConfigModule } from '@nestjs/config';
import { AuthService } from './auth.service';

@Module({
  imports: [PassportModule, ConfigModule],
  providers: [HeaderApiKeyStrategy, AuthService],
  exports: [AuthService],
})
export class AuthModule {}
