import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
  StandardSchemaSerializerInterceptor,
} from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';
import { TodosModule } from './modules/todos/todos.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';
import { CatchEverythingFilter } from './common/filters/catchEverything.filter.js';
import { RequestIdMiddleware } from './common/middlewares/requestId.middleware.js';
import { envSchema } from './config/env.schema.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
      validate: (raw) => envSchema.parse(raw),
    }),
    PrismaModule,
    TodosModule,
    UsersModule,
    AuthModule,
    AdminModule, // RBAC 演示面：/admin/* 全部要求 ADMIN
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // ⚠️ 这两个 APP_INTERCEPTOR 的**先后顺序是承重的**，别调换。
    //
    // 先声明的在外层。请求进来先过外层，响应出去先过内层，所以：
    //   StandardSchemaSerializerInterceptor（内层）先拿到 handler 的原始返回值，
    //   按 @Serialize 的 schema parse 一遍（剥掉多余字段）；
    //   然后 TransformInterceptor（外层）才把结果包成 { code, message, data } 信封。
    //
    // 调换之后：序列化拦截器会拿到**已经包好信封的对象**，而 @Serialize 声明的是 data
    // 的形状 —— 信封上没有 title / done 这些字段，于是每次响应都 500
    // "Serialization failed"，且只在**配了 @Serialize 的接口**上出现，很难定位。
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: CatchEverythingFilter,
    },
    // Nest 12 内置：读 @SerializeOptions({ schema })，即 @Serialize 写的那个。
    // 自己手搓一个同功能的拦截器也行（本项目 S9 一开始就是那么做的），
    // 但内置版多处理了两种边界：handler 直接返回**数组**（逐个元素过 schema）
    // 和 StreamableFile（跳过，不解析流）。
    {
      provide: APP_INTERCEPTOR,
      useClass: StandardSchemaSerializerInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes({ path: '/*splat', method: RequestMethod.ALL });
  }
}
