import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { getServer, setupE2eApp, teardownE2eApp } from './e2e-helpers.js';

/**
 * helmet + CORS 白名单。
 *
 * ⚠️ 期望值来自 test/setup-e2e.ts 里钉死的那一行，**不是**开发机上的 .env
 * （后者被 gitignore，断言依赖它 = 换台机器就红）。两处的字面量必须一起改。
 */
const ALLOWED = ['http://localhost:5173', 'https://allowed.example.com'] as const;
const DENIED = 'http://evil.example.com';

/**
 * ★ 这一整个文件的由来：原来的验证方式是"从非白名单 origin 发请求，看浏览器拦不拦"。
 * 那个观察本身没错——浏览器确实拦了。但**原因不是"不在白名单"**：
 * 当时 CORS_ORIGINS 是逗号连成的**一个字符串**，而 cors@2.8.6 的 configureOrigin
 * 对字符串走 "fixed origin" 分支，**无条件把它当 ACAO 回显**，于是每个响应带的都是
 * `Access-Control-Allow-Origin: http://localhost:5173,https://...` ——
 * 一个不符合规范的畸形值。浏览器把**白名单内和外部一起拒了**。
 *
 * 这就是"绿灯说错了理由"最贵的形态：现象为真、结论为假，而且**永远测不出来**，
 * 因为两边表现完全一样。所以这里的断言一律**比值，不比"有没有"**。
 */
describe('安全响应头与 CORS', () => {
  beforeAll(setupE2eApp);
  afterAll(teardownE2eApp);

  const server = () => request(getServer());

  describe('helmet', () => {
    it('全局响应带 nosniff', async () => {
      const res = await server().get('/').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    /**
     * ⚠️ 用 `toContain` 而不是 `toBe`：helmet 会把我们写的 directives
     * **合并**进它自己的一大堆默认指令（default-src/script-src 之外还有
     * style-src、img-src、object-src、base-uri、form-action...）。
     * 写死整串的话，helmet 小版本升级加一条默认指令就会让这条红得莫名其妙 ——
     * 而它其实没坏。
     */
    it('全局响应带 CSP，且 default-src 被收紧到 self', async () => {
      const res = await server().get('/').expect(200);
      const csp = res.headers['content-security-policy'];

      expect(csp).toBeDefined();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
    });
  });

  describe('CORS 白名单', () => {
    /**
     * ★ 本文件里最危险的一条就是这两个"正向"用例。
     *
     * 修 bug 之前，**每个**响应都带 ACAO（那个逗号串），所以
     * `expect(res.headers['access-control-allow-origin']).toBeDefined()`
     * 这种写法在修复前后**都是绿的** —— 它测不出任何东西。
     * 唯一有判别力的写法是断言**值恰好等于请求的那个 origin**。
     *
     * 两条都断言（而不是只测第一个）：只修成 `split(',')[0]` 的半吊子改法
     * 能让第一条过、第二条崩。少测一条就给它留了活路。
     */
    it.each(ALLOWED)('白名单 origin %s 会被原样回显', async (origin) => {
      const res = await server().get('/').set('Origin', origin).expect(200);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    });

    /**
     * 非白名单：**服务端照常处理**（返回 200 和完整响应体），只是不下发 ACAO，
     * 由浏览器去拦。这一点很关键 —— CORS 是**浏览器侧的**策略，
     * 不是服务端鉴权。拿它当访问控制用是常见误解。
     */
    it('非白名单 origin 不下发 ACAO，但请求本身仍然成功', async () => {
      const res = await server().get('/').set('Origin', DENIED).expect(200);

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.body).toBeDefined();
    });

    it('预检 OPTIONS 返回 204 且放行 POST', async () => {
      const res = await server()
        .options('/todos')
        .set('Origin', ALLOWED[0])
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);

      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED[0]);
      expect(res.headers['access-control-allow-methods']).toContain('POST');
    });

    /**
     * ★ 回归锁：把"逗号串"这个形态本身钉死。
     *
     * 上面几条断言针对的是"哪个 origin 被回显"，这条针对的是"回显出来的值像不像
     * 一个合法的 origin"。ACAO 按规范只能是 `*` 或**单个** origin，
     * 出现逗号一定是又有人在某处把数组拼成了字符串。
     *
     * ⚠️ 顺带记一条**不能**用来当凭据的头：`Vary: Origin`。
     * cors 的 configureOrigin 在**命中与不命中两个分支上都会**设它，
     * 所以它看起来像"CORS 生效了"的证据，实际零判别力。别拿它写断言。
     */
    it('ACAO 永远不含逗号（回归锁）', async () => {
      const responses = await Promise.all([
        server().get('/').set('Origin', ALLOWED[0]),
        server().get('/').set('Origin', ALLOWED[1]),
        server().get('/').set('Origin', DENIED),
      ]);

      for (const res of responses) {
        const acao = res.headers['access-control-allow-origin'];
        if (acao !== undefined) {
          expect(acao).not.toContain(',');
        }
      }
    });
  });
});
