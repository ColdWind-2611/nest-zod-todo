import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/prisma/generated/client.js';
import { Role } from '../src/prisma/generated/enums.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL']! }),
});

const rounds = Number(process.env['BCRYPT_SALT_ROUNDS'] ?? 10);

// 本地演示账号（密码走 bcrypt.hash，与 AuthService.register 存法一致）
const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'demo1357';

// 管理员账号 —— Session 7.2（RBAC / @Roles 装饰器 + RolesGuard）的测试靶子
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'admin1357';

async function upsertUser(
  email: string,
  plain: string,
  role: Role,
  todos: string[] = [],
) {
  const password = await bcrypt.hash(plain, rounds);
  await prisma.user.upsert({
    where: { email },
    // 已存在也刷新密码和角色：重跑 seed 能把库拉回已知状态，
    // 顺带修掉之前那版留下的明文占位密码
    update: { password, role },
    create: {
      email,
      password,
      role,
      todos: { create: todos.map((title) => ({ title })) },
    },
  });
  console.log(`  ${role.padEnd(5)} ${email} / ${plain}`);
}

async function main() {
  console.log('seeding...');
  await upsertUser(DEMO_EMAIL, DEMO_PASSWORD, Role.USER, [
    '学 Prisma',
    '连 Postgres',
    '给 Todo 加鉴权',
  ]);
  await upsertUser(ADMIN_EMAIL, ADMIN_PASSWORD, Role.ADMIN, [
    '准备 Session 7.2 的 RolesGuard',
  ]);
  console.log('seed done');
}

main().finally(() => prisma.$disconnect());
