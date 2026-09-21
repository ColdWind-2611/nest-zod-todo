import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { configureApp } from './config/app.setup.js';
import type { Env } from './config/env.schema.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // helmet / CORS / 全局管道 都在这里，且**它们的相对顺序是有讲究的**。
  // 别把其中任何一件搬回 main.ts —— 那样 e2e 就跑不到它了（e2e 用
  // Test.createTestingModule 起应用，main.ts 一行都不执行），会被下一个
  // "测试全绿但线上不对"的 bug 咬到。详见 config/app.setup.ts。
  configureApp(app);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
