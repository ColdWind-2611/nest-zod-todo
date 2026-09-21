import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { getServer, setupE2eApp, teardownE2eApp } from './e2e-helpers.js';

/**
 * /docs 这条路：**文档能不能生成**，以及**它头上的 helmet 是不是走对了分支**。
 *
 * ## 为什么单独一个文件，还要动 NODE_ENV
 *
 * `configureApp` 里是 `if (NODE_ENV !== 'test') setupSwagger(app)` —— 测试环境
 * **根本没有 /docs 路由**，断言它只会得到 404。所以别的 e2e 全绿**不代表** /docs 是对的。
 *
 * 好消息是 `configureApp` 是在 `setupE2eApp()` 里**运行时**才读 `process.env.NODE_ENV`，
 * 不像 `envSchema` 那样在 import 时就冻住 —— 所以在 `beforeAll` 里把它改成
 * 'development' 就够，**不需要**（也不能）靠 import 顺序。
 *
 * ⚠️ 只改这一个文件：每个测试文件是独立的进程 + 独立的 setupFiles，翻不动别人。
 *
 * ## 这个文件真正防的那个 bug
 *
 * `setupSwagger` 内部是 `httpAdapter.get('/docs', serveSwaggerHtml)` —— **调用那一刻**
 * 就注册了 express 路由，而 serveSwaggerHtml 只 `res.send()`、**不调 next()**。
 * express 按注册顺序匹配。所以只要安全中间件注册在 `setupSwagger` **之后**，
 * /docs 就先被 swagger 的 handler 吃掉，`req.path.startsWith('/docs')` 那一支
 * **一次都不执行** —— helmetForDocs 是死代码，而 /docs 上连 nosniff 都没有。
 *
 * 这个 bug 的体检报告极具欺骗性：/docs 照常打得开、别的路由照常有头、
 * 两个"手工验证"都照过。**只有直接读 /docs 的响应头才看得见。**
 */
describe('/docs（Swagger 文档）', () => {
  beforeAll(async () => {
    // 必须在 setupE2eApp() 之前 —— configureApp 是在那一刻读它的。
    process.env.NODE_ENV = 'development';
    await setupE2eApp();
  });
  afterAll(teardownE2eApp);

  const server = () => request(getServer());

  /**
   * `SwaggerModule.createDocument()` 在**应用启动时**就会把每个 schema 转成
   * OpenAPI 片段（input/output 两个方向各一遍）。schema 里一旦有不可表示的东西
   * —— 比如 `z.date()`，或者 output 方向没有对应 JSON Schema 的 `.transform()`
   * —— **这里就会抛，整个应用起不来**。
   *
   * 所以这条断言看着像废话，其实是"文档生成没崩"的唯一自动化守卫：
   * 它一旦红，先去看 `src/config/schemaConverter.ts`。
   */
  it('/docs-json 返回了 OpenAPI 文档（createDocument 没崩）', async () => {
    const res = await server().get('/docs-json').expect(200);
    expect(res.body.openapi).toBeDefined();
    expect(res.body.info.title).toContain('Todo API');
  });

  it('/docs 的 HTML 打得开', async () => {
    await server().get('/docs').expect(200).expect('Content-Type', /html/);
  });

  describe('helmet 在 /docs 上走的是放宽分支', () => {
    /**
     * ★ 这一条就是上面那个死代码 bug 的探针。
     *
     * 判别力是双向的：把 `installSecurityMiddleware(app)` 挪到 `setupSwagger(app)`
     * **后面**，这个头会立刻变成 undefined —— 因为 /docs 压根没经过分发器。
     */
    it('有 nosniff ⇒ 分发器真的跑到了 /docs，不是被 swagger 的 handler 抢先', async () => {
      const res = await server().get('/docs').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    /**
     * `helmetForDocs` 关掉的**只有** `contentSecurityPolicy` 这一项，
     * 其余头照常 —— 这正是上面那条的立足点（如果整套 helmet 都被跳过，
     * nosniff 也会没，两条会一起红，能立刻区分"分支走错"和"根本没走")。
     */
    it('没有 CSP ⇒ 走的确实是 helmetForDocs', async () => {
      const res = await server().get('/docs').expect(200);
      expect(res.headers['content-security-policy']).toBeUndefined();
    });

    it('其余 helmet 头仍在 ⇒ 关掉的只有 CSP 一项，不是整套', async () => {
      const res = await server().get('/docs').expect(200);
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['x-dns-prefetch-control']).toBeDefined();
    });
  });

  describe('对照组：普通路由走的仍是严格分支', () => {
    it('/ 有 CSP，且含 default-src self', async () => {
      const res = await server().get('/').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(String(res.headers['content-security-policy'])).toContain(
        "default-src 'self'",
      );
    });
  });
});
