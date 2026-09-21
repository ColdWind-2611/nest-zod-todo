# Stage 2 · 多用户 Todo API

NestJS v12 + Prisma 7 + Zod 写的一个完整 CRUD 服务：多用户、JWT 鉴权、RBAC，配 48 条测试。

> 这份 README 面向"第一次拿到这个仓库、想把它跑起来"的人。
> 想理解**为什么**这么写，看下一节的「四处分歧」—— 这个项目的设计取舍都收在那张表里。

---

## 先看这里：与「标准 Nest 教程」的四处分歧

照网上教程的印象来读这套代码会一直困惑，所以摆在最前面：

| 常见做法 | 本项目 | 为什么 |
| --- | --- | --- |
| `class-validator` + `ValidationPipe` | **只写 Zod**，用 Nest 12 原生的 Standard Schema（`@Body({ schema })`） | 校验与 Swagger 文档**同源** —— 一份 schema 既校验又生成文档，不会漂移。**本项目没有任何 `class-validator`** |
| `passport` + `JwtAuthGuard` | 手写 `AuthGuard`（`src/common/guards/`） | 想看清除 token 是怎么被解析、验证、挂到请求上的。少一层黑盒 |
| 越权 `403` / 不存在 `404` | **统一 404** | 403 会告诉攻击者"这个 id 真实存在，只是不属于你"。统一成 404 不泄漏存在性 |
| `@Exclude()` / `ClassSerializerInterceptor` | `@Serialize(zodSchema)` 做出参校验 | 同"校验与文档同源"：出口契约也由 Zod 描述，写错字段直接 500 而不是静默泄字段 |

---

## 快速开始

需要 Node 20+、pnpm、Docker。

```bash
pnpm install

# ① 造 .env —— 复制后**必须**改掉 JWT_SECRET
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# ② 只起 Postgres（docker-compose.yml 里只有 db 一个服务）
docker compose up -d db

# ③ 建表 + 灌演示数据
pnpm exec prisma migrate dev
pnpm exec prisma db seed

# ④ 起来
pnpm start:dev
```

- 服务：http://localhost:3000
- Swagger UI：http://localhost:3000/docs ← **在这里点两下就能验完所有接口**，不用 curl

种子数据造了两个账号，Swagger 的 `Description` 里也写着：

| 邮箱 | 密码 | 角色 |
| --- | --- | --- |
| `demo@example.com` | `demo1357` | USER |
| `admin@example.com` | `admin1357` | ADMIN |

在 Swagger 里展开 `auth → POST /auth/login` 执行一次，复制响应里的 `access_token`，
点右上角 **Authorize** 粘进去（不用加 `Bearer ` 前缀），之后所有接口都能直接 Try it out。

> **Prisma 7 的两个坑**（别照抄旧教程）：
> ① 配置文件名是 **`prisma7.config.ts`**（v7 的首选名）；② `migrate reset` **不会**自动跑 seed。

### 四个 `.env` 文件各管什么

`app.module.ts` 里是 `envFilePath: ['.env.<环境>', '.env']` —— **数组靠前的优先**，`NODE_ENV` 决定第一个文件名落成什么。四个文件全被 `.gitignore` 挡住，**只有 `.env.example` 会进仓库**。

| 文件 | 放什么 | 提交 |
| --- | --- | --- |
| `.env` | **机密 + 通用值**。`JWT_SECRET` 是全项目唯一的真机密 | ❌ |
| `.env.development` | 开发环境的**差异值**。当前留空 = 全部走 `.env` | ❌ |
| `.env.test` | 测试的差异值。**空是故意的**（理由见下） | ❌ |
| `.env.production` | 生产环境的差异值。**别在这写真实机密** | ❌ |
| `.env.example` | 形状说明书：clone 下来照它填 `.env` | ✅ |

**`.env.test` 为什么空**：e2e 要的东西，`test/setup-e2e.ts` 在**建应用之前**就已经写进 `process.env` 了（`DATABASE_URL = DATABASE_URL_TEST`、`NODE_ENV = 'test'`），而 `@nestjs/config` **不会覆盖 `process.env` 里已存在的键** —— 所以在这再写一遍 `DATABASE_URL` 是无用功，写了反而让人误以为它在起作用。

**新增环境变量的规矩**：先加到 `src/config/env.schema.ts`（启动即校验），再加到 `.env.example`（让人知道要配），最后才允许在代码里读。跳过任何一步都等于埋下"配置漂移"。

> ⚠️ **`.env` 只应该存在于开发机上。** `envFilePath` 的第二个元素是写死的 `.env`，所以生产环境实际会变成 `['.env.production', '.env']`。如果生产机上躺着一个开发用的 `.env`、而 `.env.production` 又是空的，应用会**静默连上开发库、用开发密钥签发 token**，而且启动一切正常 —— 最难排查的那类故障。这道防线靠运维纪律（生产机房不放 `.env`，机密由部署平台注入），不是代码保证。

---

## 接口一览

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/` | 匿名 | 健康检查。标了 `@Public()`，给探针用 |
| POST | `/auth/register` | 匿名 | 注册，**直接返回 token**（不用再 login 一次） |
| POST | `/auth/login` | 匿名 | 登录，返回 `200`（见下方排查笔记） |
| GET | `/auth/me` | 需 token | 回 token 里的载荷本身（`id`/`email`/`role`） |
| POST | `/todos` | 需 token | 新建 |
| GET | `/todos` | 需 token | 列表，分页 `?page=&pageSize=&done=` |
| GET | `/todos/:id` | 需 token | 单条。只能碰自己的 |
| PATCH | `/todos/:id` | 需 token | 改 `title` / `done` |
| DELETE | `/todos/:id` | 需 token | 删。回 `{ count }` 而不是 204 |
| GET | `/admin/todos` | **ADMIN** | 全部用户的 todo，分页 |
| DELETE | `/admin/todos/:id` | **ADMIN** | 删任意一条 |

**所有响应都包在同一层信封里**（`TransformInterceptor` 产出）：

```jsonc
// 成功
{ "code": 200, "message": "OK", "data": { /* 真正的载荷 */ } }
// 失败（CatchEverythingFilter 产出，恰好这三个字段，多一个都算 bug）
{ "code": 404, "message": "Todo #12 不存在", "traceId": "..." }
```

> `code` **等于真实 HTTP 状态码**，不是写死的 200。所以创建类接口是 `code: 201`，
> 而登录因为盖了 `@HttpCode(200)` 是 `code: 200`。写前端断言时注意这一条。

`traceId` 是排查入口：每条日志都带同一个 `[requestId]` 前缀，能串起一次请求的完整链路。

---

## 测试

```bash
pnpm test        # 单测（23 条）—— 不需要数据库，纯逻辑 + mock
pnpm test:e2e    # e2e （25 条）—— 需要 Postgres 起着
```

**`test:e2e` 是冒号不是空格。** `pnpm test e2e`（空格）是把 `e2e` 当参数传给单测配置，
结果是单测跑一遍、e2e 一条没跑，而且**全绿** —— 别被它骗了。

e2e 用的是**独立的测试库**，不碰开发库。首次跑之前要建它（复用同一个容器）：

```bash
docker exec stage2-postgres createdb -U postgres stage2_test
pnpm exec prisma db push --url "postgresql://postgres:postgres@localhost:5432/stage2_test?schema=public"
```

> 测试库用 `db push` 而不是 `migrate`：它**不保留迁移历史**，每次都可以推倒重来。
> ⚠️ 推库前扫一眼命令里写的是 `stage2_test` 而不是 `stage2` —— 推错库是
> "测试数据写进开发库"最常见的原因。

---

## 目录结构

```
src/
  common/
    decorators/      @Public @Roles @CurrentUser @Serialize @ApiErrorResponses
    guards/          AuthGuard（鉴权）· RoleGuard（RBAC）
    interceptors/    TransformInterceptor（信封）· 内置的序列化拦截器
    filters/         CatchEverythingFilter（兜底，保证错误也是信封形状）
    schemas/         跨模块复用的 Zod schema（分页、响应信封、JWT 载荷）
    request-context/ AsyncLocalStorage 存 requestId
  config/            app.setup.ts（★ 见下）· swagger.config.ts · schemaConverter.ts
  modules/           auth · todos · admin · users（users 暂无路由，留作扩展点）
  prisma/            PrismaService + 生成的 client
test/                e2e-helpers.ts（公共零件）· *.e2e-spec.ts
```

### ★ `config/app.setup.ts` 为什么存在

`main.ts` 和 e2e 都调它。因为 e2e 用 `Test.createTestingModule({ imports: [AppModule] })`
起的应用 —— **`main.ts` 一行都不会执行**，而全局管道恰好写在 `main.ts` 里。

少了这一步，`{ "title": "" }` 会返回 201 而不是 400：整套 e2e 在测一个**没有校验的应用**，
而且**全绿**。（`APP_GUARD` / `APP_INTERCEPTOR` / `APP_FILTER` / 中间件因为是模块 provider
反而会自动生效，所以只有管道这一处会静默消失。）
把配置抽成 `configureApp(app)` 给两边共用，是唯一能根治的写法。

---

## ★ 排查笔记

### 出参序列化报 500，但错误消息不说缺哪个字段

`@Serialize(someSchema)` 的校验失败会走 500。**内置序列化拦截器的错误消息只给一句
`Invalid input: expected date, received undefined`，不带字段路径** —— schema 里字段一多就抓瞎。

排查法是**拿 schema 的字段去对查询的 `select` / `include`**：

```
`@Serialize(todoSchema)` 里声明了 { id, title, done, createdAt, ownerId }
        ↓ 逐字段对照
service 里那条 prisma 查询的 select / include 有没有把它们都取出来？
```

九成情况是 service 的 `select` 漏了字段（或者用了 `select` 却没写全），
对象上缺 key，于是校验在"缺字段"上报错，而错误消息不会告诉你缺的是 `createdAt`。

> 这条是**有意不修**的：换成自己写的序列化拦截器能带上路径，但会多维护一套拦截器。
> 当前规模下"对一遍 select"更省事。等 schema 字段多到对不动了再换。

### 登录返回 200，而其他 POST 返回 201

Nest 对**所有** POST 默认返回 201（`router-response-controller` 的 `getStatusByMethod`）。
登录只读不建资源，201 Created 语义不对，所以 `@Post('login')` 上挂了 `@HttpCode(200)`。

改 `@HttpCode` 时**记得同步 `@Serialize` 的 `status`** —— 那个值直接喂给 `@ApiResponse`，
不同步就会"文档上标 201、实际返 200"。

### 应用启动即崩，报 `Date cannot be represented in JSON Schema`

`createDocument()` 在**启动时**就会去转 schema，而内置转换器遇到 `z.date()` 会抛异常
（JSON Schema 没有日期类型）。本项目 `todoSchema` 带 `createdAt: z.date()`，所以必须给
`configureApp` 传自定义的 `standardSchemaConverter`（`src/config/schemaConverter.ts`）。

同理，**加了 `@Serialize` 之后才崩**通常意味着那个 schema 的输出侧转不动了 ——
比如 `.transform()` 在 output 方向没有可表示的 JSON Schema，`.codec(in, out)` 才有。

---

## 常用命令

```bash
pnpm start:dev                 # 开发（watch）
pnpm build && pnpm start:prod  # 生产构建 + 起 dist
pnpm lint                      # oxlint（不是 eslint）
pnpm exec tsc --noEmit         # 类型检查
pnpm exec prisma migrate dev   # 建/改表
pnpm exec prisma db seed       # 灌演示数据
docker compose up -d db        # 起 Postgres
```

---

## License

[MIT](LICENSE) © 2026 ColdWind-2611
