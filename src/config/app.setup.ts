import {
  type INestApplication,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import type { Env } from './env.schema.js';
import { setupSwagger } from './swagger.config.js';

export function configureApp(app: INestApplication) {
  // ★ 顺序是承重的，别把它挪到 setupSwagger 后面。理由见 installSecurityMiddleware 的注释。
  installSecurityMiddleware(app);

  // ⚠️ 这一行不是可选项 —— 少了它，下面所有 `@Body({ schema })` 都会**静默不校验**。
  //
  // `{ schema }` 只是把 schema 挂成参数元数据（`metadata.schema`），它本身不执行任何逻辑。
  // 真正去读这份元数据、跑校验的，是管道。挂元数据不注册管道 = 文档有了、校验没有，
  // 危险程度高于两者都没有：Swagger UI 上写着 "required / minLength: 8"，
  // 实际却什么都能塞进去。
  //
  // 用内置的而不是自己写一个，是因为它多做了一件手搓版没做的事：
  // 校验前先 `stripProtoKeys()`，删掉 body 里的 `__proto__` / `prototype` / `constructor`
  // （原型链污染防御）。错误消息格式两者一致，都是 `['字段: 原因', ...]`。
  //
  // 注册成「全局」而非逐参数 `pipes: [new ZodValidationPipe()]`：全局是**漏不掉**的，
  // 新增接口只要写了 `{ schema }` 就自动被校验；逐参数写法一旦忘了写那串 pipes，
  // 就退化成上面说的「有文档、没校验」。安全默认值应当是 fail-safe 而不是 fail-open。
  app.useGlobalPipes(new StandardSchemaValidationPipe());

  // 生产环境想关掉文档的话：`if (process.env.NODE_ENV !== 'production') setupSwagger(app);`
  // 文档在测试里没有意义，且 createDocument 要扫全部元数据、会拖慢每个 e2e 文件，
  // 所以只在真实启动时挂。
  if (process.env.NODE_ENV !== 'test') {
    setupSwagger(app);
  }
}

/**
 * helmet + CORS。**必须在 setupSwagger 之前调用。**
 *
 * ★ 为什么顺序是承重的：
 *
 * `@nestjs/swagger` 的 setupSwagger 内部走的是 `httpAdapter.get(finalPath, serveSwaggerHtml)`
 * —— 也就是 express 的 `app.get('/docs', ...)`，**在调用那一刻就注册了路由**，
 * 不是等 app.init()。而 serveSwaggerHtml 是 `res.send(html)`，它**不调 next()**。
 *
 * express 按注册顺序匹配，先命中者自己结束响应。所以：
 *   安全中间件注册在 setupSwagger 【之后】 → /docs 先被 swagger 的 handler 吃掉 →
 *   `req.path.startsWith('/docs')` 这一支**一次都不会执行** → /docs 上连 nosniff 都没有，
 *   helmetForDocs 是彻头彻尾的死代码。
 *
 * 注意这个 bug 的"体检报告"极具欺骗性：它既没让 /docs 打不开，
 * 也没让别的路由少头 —— 两个手工验证都会照样通过。
 *
 * 它是 test/docs.e2e-spec.ts 抓出来的（那份用例用 `beforeAll` 把 NODE_ENV 翻成
 * 'development'，绕开"测试环境跳过 setupSwagger"这条限制）。顺序被挪错时，
 * 那条 `nosniff` 断言会立刻变红，**上面这段注释就是它的说明书**。
 *
 * 反过来说，这也是把这两件事从 main.ts 搬进来的收益：main.ts 里它们的相对顺序
 * 是"读代码时看得到的耦合"，搬到这里就成了一个函数内的调用顺序，改错一眼能看见。
 */
function installSecurityMiddleware(app: INestApplication) {
  // 1. 严格 CSP（除 /docs 外的所有路由）
  const helmetWithCsp = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [`'self'`],
        // 注意：这里不要加 unsafe-inline 或 unsafe-eval
        scriptSrc: [`'self'`],
      },
    },
  });

  // 2. 放宽的 CSP（只给 /docs）
  // Swagger UI 是第三方生成的页面，内联脚本躲不掉，直接关掉 CSP 是最务实、最不容易
  // 出错的方案。⚠️ 关的是 `contentSecurityPolicy` 这一项，helmet 的其余头
  // （nosniff / frameguard / HSTS...）**照常生效** —— 所以 /docs 仍有 nosniff，
  // 这正是下面探针用来判断"分发器到底跑没跑"的依据。
  const helmetForDocs = helmet({ contentSecurityPolicy: false });

  app.use((req: Request, res: Response, next: NextFunction) => {
    (req.path.startsWith('/docs') ? helmetForDocs : helmetWithCsp)(req, res, next);
  });

  // 3. CORS 白名单
  // `CORS_ORIGINS` 在 env.schema.ts 里已经被 transform 成 string[]（理由见那里的注释：
  // 字符串形态会被 cors 当"固定 origin"无条件回显，白名单形同虚设）。
  // 这里不做 array/function 的兜底转换 —— 让类型系统逼着配置必须是数组。
  //
  // 有意**不加** `credentials: true`（3.2 计划书里写了，这里偏离）：本服务用
  // Bearer token 而不用 cookie，`Access-Control-Allow-Credentials: true` 不会带来
  // 任何收益，只会把"允许携带凭据"这个能力白白敞开。等哪天真用上 cookie 再加。
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
  });
}
