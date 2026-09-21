import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { zodOpenApiConverter } from './schemaConverter.js';

/**
 * Bearer 安全方案的**名字**。
 *
 * 这里定义、`@ApiBearerAuth(BEARER_AUTH_NAME)` 引用，两边共用一个常量 ——
 * 名字对不上时 Swagger UI 不会报错，只是 Authorize 按钮和接口"脱钩"了
 * （填了 token 也带不上去），是个很难查的哑巴 bug。共用一个常量就不会对不上。
 */
export const BEARER_AUTH_NAME = 'access-token';

/**
 * Swagger (OpenAPI) 接入。
 *
 * ## 文档 schema 从哪来
 *
 * 没有任何 `@ApiProperty`，也没有 `createZodDto` —— 文档直接由**校验用的那份 Zod schema**
 * 长出来。链路是三段：
 *
 * 1. 控制器上把 schema 挂到参数装饰器：`@Body({ schema: createTodoSchema })`
 *    （老写法 `@Body(new ZodValidationPipe(createTodoSchema))` 把 schema 藏进了 pipe 实例，
 *    Swagger **看不见**，于是 UI 上显示 "No parameters" —— 这就是 S9 要修的那个 bug）。
 * 2. 响应侧由 `@Serialize(todoSchema)` 挂，它内部把同一份 schema 交给 `@ApiResponse`。
 * 3. `@nestjs/swagger` 拿到 schema 后，交给下面这个 `standardSchemaConverter` 转成 OpenAPI 片段。
 *
 * ## 为什么必须显式传 `standardSchemaConverter`
 *
 * 内置的转换器走 Zod 的 `~standard.jsonSchema`，遇到 `z.date()` 会**抛异常**
 * （JSON Schema 没有日期类型），而本项目 `todoSchema` 带 `createdAt: z.date()`，
 * 结果是 `createDocument()` 启动即崩。详见 `./schemaConverter.ts` 里的实测记录。
 *
 * 所以这里传的是 `zodOpenApiConverter`（`zod-openapi` 实现，把 Date 降级成 string）。
 * 它**替换**内置路径，不是叠加。`zod-openapi` 早已在依赖里，无需新装包，
 * 也不需要 `nestjs-zod` 的 `patchNestJsSwagger()`。
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Stage 2 · 多用户 Todo API')
    .setDescription(
      [
        'NestJS v12 + Prisma 7 + Zod（校验与文档同源）。',
        '',
        '### 怎么在这里跑通',
        '1. 展开 **auth → POST /auth/login**，用 `demo@example.com` / `demo1357`',
        '   （管理员用 `admin@example.com` / `admin1357`）执行一次。',
        '2. 复制响应里的 `access_token`。',
        '3. 点右上角 **Authorize**，粘进去（不用加 `Bearer ` 前缀），Authorize。',
        '4. 之后所有受保护接口都能直接 **Try it out**。刷新页面 token 不会丢。',
        '',
        '### 响应约定',
        '- 成功：`{ code, message: "OK", data }`，其中 `code` **等于真实 HTTP 状态码**',
        '  （POST 创建类接口是 201；登录因为盖了 `@HttpCode(200)`，是 200）',
        '- 失败：`{ code, message, traceId }`，`code` 同样是 HTTP 状态码（400 / 401 / 404 …）',
        '',
        '出错时把 `traceId` 拿去和后端日志对照 —— 每条日志都带同一个 `[requestId]` 前缀，',
        '能把一次请求的完整处理链串起来。',
      ].join('\n'),
    )
    .setVersion('1.0')
    // Bearer 鉴权按钮：没有它，受保护接口在 Swagger 里根本没法试
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      BEARER_AUTH_NAME,
    )
    .addTag('auth', '注册 / 登录 / 取当前用户 —— 登录接口是 @Public，其余要 token')
    .addTag('todos', '当前用户的 todo。归属校验：只能碰 ownerId === 自己的那些')
    .addTag('admin', '管理员视角。RBAC：整个 controller 要求 ADMIN 角色')
    .addTag('app', '健康检查')
    .build();

  // 第三个参数是关键：把 Zod schema 的转换权交给 zod-openapi。
  const document = SwaggerModule.createDocument(app, config, {
    standardSchemaConverter: zodOpenApiConverter,
  });

  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      // 刷新页面后 token 不丢，省得每次都要重新 Authorize
      persistAuthorization: true,
      tagsSorter: 'alpha',
      docExpansion: 'list',
    },
  });
}
