import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
  StandardSchemaSerializerInterceptor,
} from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';
import { TodosModule } from './modules/todos/todos.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';
import { CatchEverythingFilter } from './common/filters/catchEverything.filter.js';
import { RequestIdMiddleware } from './common/middlewares/requestId.middleware.js';
import { envSchema, type Env } from './config/env.schema.js';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
      validate: (raw) => envSchema.parse(raw),
    }),
    // 限流。开关走 forRootAsync 是为了能注入 ConfigService —— 这样"要不要限流"
    // 必须来自经过 zod 校验的配置，而不是某处裸读 process.env。
    //
    // ★ skipIf 让整套 e2e 能跑起来的机理（源码：@nestjs/throttler/dist/throttler.guard.js）
    //
    // 它不是一个"更弱的守卫"，而是**装配层**的开关：
    //   ① canActivate 第 63 行**第一步**就是 `if (await this.shouldSkip(context)) return true;`
    //      —— 在任何计数、任何 key 生成之前就返回了；
    //   ② 第 75 行 `const skipIf = namedThrottler.skipIf || this.commonOptions.skipIf`
    //      读的是**数组元素本身**上的 skipIf。而 @Throttle 只能覆盖
    //      limit/ttl/blockDuration/getTracker，**绕不过 skipIf**；
    //   ③ onModuleInit 里是 `Object.assign({}, opt, { name })`，数组元素上的 skipIf
    //      会被原样保留 —— 所以直接写在下面这个对象上就行，不必改成对象形式。
    //
    // 为什么需要它：本项目的 e2e 一共约 27 次登录，而登录是 5 次/60 秒 + 封禁 300 秒，
    // 第 6 次开始全变 429 —— 测试会被自己挡住。
    //
    // ⚠️ 别用 `overrideGuard(ThrottlerGuard)` 来顶替这个开关，它会**静默失效**：
    //    overrideGuard → override(t, isProvider: false) → Module.replace，
    //    而 isProvider:false 时只有 hasInjectable(t) 命中才会替换；
    //    APP_GUARD 的 useClass 在 scanner 里被改名成 "Symbol(APP_GUARD) (UUID: ...)"
    //    塞进 _providers，不在 _injectables 里 —— 于是它不报错、也不生效。
    //    静默失效比报错危险得多：它会让你对错误的原因下结论。
    //
    // ⚠️ 关掉它的正当理由（前置 Nginx/WAF 已经限流）与危险（暴力破解防护归零）
    //    写在 .env.example 里，README 的安全一节也有。
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        {
          name: 'default',
          ttl: seconds(60),
          limit: 100,
          skipIf: () => config.get('RATE_LIMIT_ENABLED', { infer: true }) === false,
        },
      ],
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
