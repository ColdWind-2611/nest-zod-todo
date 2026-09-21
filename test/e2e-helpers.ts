/**
 * e2e 的公共零件。
 *
 * 抽出来的理由：`*.e2e-spec.ts` 应该只读得懂"这个接口该返回什么"，
 * 而不该被"怎么起应用、怎么造一个管理员、怎么比较两条错误"这类**基建细节**淹没。
 * 用例是一次性的，这些函数是每个后续 e2e 文件都要复用的模板。
 *
 * ⚠️ 本文件**不是**测试文件（不匹配 `test/**\/*.e2e-spec.ts`），
 * 不会被 vitest 当成用例收集。
 */
import 'reflect-metadata';
import { expect } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/config/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { Role } from '../src/prisma/generated/enums.js';

// 一个 e2e 文件 = 一个进程内的应用实例，用模块级变量持有即可。
let app: INestApplication;
let prisma: PrismaService;

/** 注册/登录用的合法密码：≥8 位，满足注册强度 */
export const TEST_PASSWORD = 'pw123456';

// ─────────────────────────── 应用生命周期 ───────────────────────────

/**
 * 起一个 e2e 用的应用实例。放在 `beforeAll` 里调。
 *
 * ★ 关键的一行是 `configureApp(app)`：e2e import 的是 `AppModule`，
 * **`main.ts` 一行都不会执行**，而全局管道是写在 `main.ts` 里的。
 * 少了它，`{ title: '' }` 会返回 201 而不是 400 —— 整套用例在测一个没有校验的应用，
 * 而且**全绿**。（APP_GUARD / APP_INTERCEPTOR / APP_FILTER / 中间件因为是模块
 * provider，反而会自动生效，所以只有管道这一处会静默消失。）
 */
export async function setupE2eApp(): Promise<void> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  prisma = app.get(PrismaService);
}

/** 放 `afterAll`：少了它会"测试全绿但进程不退"。 */
export async function teardownE2eApp(): Promise<void> {
  await app.close();
}

/**
 * 清库。放 `beforeEach`。
 *
 * 顺序不能反：先删"叶子"（todo 有指向 user 的外键），再删"被引用者"，
 * 否则 `Foreign key constraint failed`。
 */
export async function resetDatabase(): Promise<void> {
  await prisma.todo.deleteMany();
  await prisma.user.deleteMany();
}

/**
 * 应用自己那条数据库连接。
 *
 * ★ 不要自己 `new PrismaClient()` —— 那会另开一条连接，
 * 于是"清表清了，但数据还在应用那个库里"，第二条用例撞上唯一约束报 409，
 * 而你会以为是用例写错了。
 */
export function db(): PrismaService {
  return prisma;
}

/** supertest 要的那个 http server。 */
export function getServer() {
  return app.getHttpServer();
}

/**
 * 拿到应用容器本体，用来 `container().get(SomeService)` 取出**单例**。
 *
 * 典型用途：想把某个 service 方法临时改坏以验证兜底路径。
 * ★ 必须从这里取，**不能** `new TodosService(...)` ——
 * 新对象不在 Nest 的实例图谱里，controller 用的仍是容器里那个，
 * 于是"改坏了却什么也没发生" —— 测试**静默假绿**，不报任何错。
 */
export function container(): INestApplication {
  return app;
}

// ─────────────────────────── 造数据 ───────────────────────────

export type TestUser = {
  id: number;
  email: string;
  password: string;
  role: Role;
  token: string;
};

export async function bearer(token: string): Promise<string> {
  return `Bearer ${token}`;
}

let userSeq = 0;

/** 每个用例都要一个干净的身份，邮箱不能撞唯一约束。 */
function uniqueEmail(): string {
  userSeq += 1;
  return `u${userSeq}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
}

/**
 * 注册并登录，返回可用的身份。
 *
 * `role: 'ADMIN'` 时直接改库提权 —— 项目没有也不该有"注册成管理员"的接口。
 * 注意顺序：**必须改完角色再登录**，因为 token 里的 role 是签发那一刻写死的，
 * 先登录再改库，拿到的 token 里仍然是 USER。
 */
export async function createUser(
  options: { role?: Role } = {},
): Promise<TestUser> {
  const { role = 'USER' } = options;
  const email = uniqueEmail();

  await request(getServer())
    .post('/auth/register')
    .send({ email, password: TEST_PASSWORD })
    .expect(201);

  if (role !== 'USER') {
    await prisma.user.update({ where: { email }, data: { role } });
  }

  const token = await login(email);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });

  return { id: user.id, email, password: TEST_PASSWORD, role, token };
}

/**
 * 登录换 token。
 *
 * ★ `expect(200)` 而不是 201：`@Post('login')` 上挂了 `@HttpCode(200)`。
 * Nest 对**所有** POST 默认返回 201（`router-response-controller` 的 `getStatusByMethod`），
 * 但登录只读不建资源，201 语义不对，所以在控制器上显式覆盖了。
 * 写在这个助手里的好处是：**每一条 e2e 都会经过它**，改回去会立刻大面积变红。
 *
 * `res.body?.data?.access_token` 这一层 `.data` 是关键：全局 `TransformInterceptor`
 * 把响应包成了 `{ code, message, data }`。**所有 body 断言都要多穿这一层。**
 *
 * 顺带把信封的 `code` 也断言上：它现在读的是真实 HTTP 状态码
 * （`ctx.switchToHttp().getResponse().statusCode`），不再是硬编码的 200。
 * 这两件事是同一个改动的一体两面，钉在一起才不会只改对一半。
 *
 * token 缺失时 `throw` 并把完整 body 打出来 —— 哪天信封形状变了，
 * 你会立刻看到真实响应长什么样，而不用手动加 `console.log` 再跑一遍。
 */
export async function login(
  email: string,
  password = TEST_PASSWORD,
): Promise<string> {
  const res = await request(getServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);

  expect(res.body?.code).toBe(200);

  const token = res.body?.data?.access_token;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(`登录响应里没有 token。body=${JSON.stringify(res.body)}`);
  }
  return token;
}

export type TestTodo = {
  id: number;
  title: string;
  done: boolean;
  createdAt: string;
  ownerId: number;
};

/** 建一条 todo 并返回实体（`data` 那一层已经剥掉）。 */
export async function createTodo(
  token: string,
  title: string,
): Promise<TestTodo> {
  const res = await request(getServer())
    .post('/todos')
    .set('Authorization', await bearer(token))
    .send({ title })
    .expect(201);

  return res.body.data as TestTodo;
}

// ─────────────────────────── 断言助手 ───────────────────────────

type ErrorBody = {
  code?: number;
  message?: string | string[];
  traceId?: string;
  [key: string]: unknown;
};

/**
 * 把错误响应归一化，好让"别人的资源"和"不存在的资源"能逐字比较：
 * - 抹掉 `traceId`（每次请求都是不同的随机串）
 * - 把 message 里的 `#12` 这类 id 换成 `#<id>`（两条路径的 id 本来就不同）
 */
export function normalizeError(body: ErrorBody) {
  const { traceId: _drop, message, ...rest } = body;
  return {
    ...rest,
    message:
      typeof message === 'string' ? message.replace(/#\d+/g, '#<id>') : message,
  };
}

/**
 * 断言两条错误响应**除 id 外一字不差**。
 *
 * 这是"不泄漏存在性"这条安全决策的自动化守卫：一旦 403 / 404 被区分开，
 * 攻击者就能拿它探测"哪些 id 是真实存在的"。
 */
export function expectSameError(a: ErrorBody, b: ErrorBody): void {
  expect(normalizeError(a)).toEqual(normalizeError(b));
}

/**
 * 出口白名单（S9.2）的通用检查：响应里不该出现密码相关的东西。
 *
 * 不只查 `password` 字段名，也查 bcrypt hash 的前缀 —— 万一字段被改名成
 * `pwd` 之类的，hash 本身还是会被搜出来。
 */
export function expectNoPasswordLeak(res: { body: unknown }): void {
  const raw = JSON.stringify(res.body);
  expect(raw).not.toContain('password');
  expect(raw).not.toContain('$2b$');
}

/** 断言响应体**恰好**是这三个字段 —— 多一个字段（比如堆栈）都要红。 */
export function expectErrorEnvelope(
  body: ErrorBody,
  expected: { code: number; traceId?: string },
): void {
  expect(Object.keys(body).sort()).toEqual(['code', 'message', 'traceId']);
  expect(body.code).toBe(expected.code);
  if (expected.traceId !== undefined) {
    expect(body.traceId).toBe(expected.traceId);
  }
}
