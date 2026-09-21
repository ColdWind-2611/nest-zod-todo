import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaClient } from './generated/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema.js';
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  // 用 Nest 的 Logger 而不是 console.log：带上下文名、能按级别过滤、
  // 启动日志和业务日志不会混成一团
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
      }),
      log: ['warn', 'error'],
    });
  }
  //🟢 启动时：真·开数据库连接
  async onModuleInit() {
    await this.$connect();
    this.logger.log('🟢 数据库已连接');
  }

  // 🔴 关闭时：真·关连接
  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('🔴 数据库连接已关闭');
  }
}
