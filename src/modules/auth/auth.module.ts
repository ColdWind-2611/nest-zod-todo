import { Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { RoleGuard } from '../../common/guards/role.guard.js';
import { Env } from '../../config/env.schema.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('JWT_EXPIRES_IN', { infer: true }),
        },
      }),
    }),
  ],
  providers: [
    AuthService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard, // 在 AuthModule 作用域，JwtService 就在这里注册的
    },
    {
      provide: APP_GUARD,
      useClass: RoleGuard,
    },
  ],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
