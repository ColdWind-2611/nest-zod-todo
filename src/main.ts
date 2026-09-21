import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './config/app.setup.js';
import { ConfigService } from '@nestjs/config';
import { Env } from './config/env.schema.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  await app.listen(config.get('PORT', { infer: true }));
  console.log(`NODE_ENV=${config.get('NODE_ENV', { infer: true })}`);
}
await bootstrap();
