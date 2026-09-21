// ⚠️ 这一行必须是本文件的第一条 import，且不能删 —— 它把限流开关翻回 'true'。
// 理由（以及"调换了会怎样"）写在 test/setup-throttle.ts 里。
import './setup-throttle.js';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  expectErrorEnvelope,
  getServer,
  setupE2eApp,
  teardownE2eApp,
} from './e2e-helpers.js';

/**
 * 限流**真的生效**的那一半。
 *
 * 为什么单独一个文件：其余 e2e 都跑在 `RATE_LIMIT_ENABLED=false` 下（否则本项目的
 * 27 次登录会被自己挡住），所以"限流到底有没有用"这件事在那些文件里**永远验不到**。
 * 一个全程关闭的功能，和"写了但根本没接上"的功能，在测试报告上长得一模一样。
 *
 * 本文件刻意**不做 resetDatabase、不造用户**：下面三条请求都不写库
 * （登录用的是不存在的邮箱，另外两条连 token 都不带）。
 */
describe('限流（ThrottlerGuard）', () => {
  beforeAll(setupE2eApp);
  afterAll(teardownE2eApp);

  const server = () => request(getServer());

  /**
   * 坑 1 的顺序：限流守卫必须排在鉴权守卫**前面**。
   *
   * 这个断言之所以能证伪，是因为 `ThrottlerGuard.canActivate` 走完计数后会
   * `res.header('X-RateLimit-Limit'...)` 再 return true（throttler.guard.js:137-143），
   * 然后 AuthGuard 才抛 401。而 Nest 的守卫是**短路**的：前一个抛异常，后面的根本不会执行。
   * 所以如果顺序是 Auth → Throttle，这些响应上**一个 X-RateLimit-* 都不会有**。
   *
   * 用 2 个请求就能问出答案，不必真把限流打满。
   */
  it('限流先于鉴权：未带 token 的 401 上也带着计数头', async () => {
    const first = await server().get('/auth/me').expect(401);
    const second = await server().get('/auth/me').expect(401);

    // 头名没有后缀：generateKey/generateSuffix 对名为 'default' 的 throttler 取空串。
    expect(first.headers['x-ratelimit-limit']).toBe('100');
    expect(first.headers['x-ratelimit-remaining']).toBeDefined();

    // 第二次比第一次少 1 —— 证明它**数了**，而不只是无脑回了个常量。
    expect(Number(second.headers['x-ratelimit-remaining'])).toBe(
      Number(first.headers['x-ratelimit-remaining']) - 1,
    );
  });

  /**
   * 坑 4：未鉴权的请求也会被计入限流，打满之后返回 429。
   *
   * ★ 这里能"打满"，正是 `generateKey` 的粒度决定的：
   *   `sha256(ControllerName-handlerName-throttlerName-tracker)`
   *   —— 计数桶是**按「控制器+处理器」各一份**，不是全局一个总桶。
   *   所以 100 次全落在 TodosController-list 这个桶里，既不会影响别的用例，
   *   反过来说，**攻击者把请求分散到不同路由就能绕开这个额度** ——
   *   它是防误用/防单点爆破的，不是防分布式爬取的（那需要 3.3 的共享存储 + 网关）。
   *
   * 401 而不是 404：AuthGuard 先于路由处理，未带 token 时压根不会走到 service。
   */
  it('未鉴权也能打满：GET /todos 第 101 次返回 429', async () => {
    for (let i = 0; i < 100; i += 1) {
      await server().get('/todos').expect(401);
    }

    const res = await server().get('/todos').expect(429);

    expectErrorEnvelope(res.body, { code: 429 });
    // 429 这条路径上**只有** Retry-After，没有 X-RateLimit-* ——
    // throwThrottlingException 在设置那三个头之前就抛了（throttler.guard.js:122-135）。
    // 写错成 expect(x-ratelimit-limit) 会得到一个很莫名其妙的失败。
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
  });

  /**
   * 登录的专属额度：5 次/60 秒，超了封禁 300 秒（控制器上的 `@Throttle`）。
   *
   * 用**不存在的邮箱**打，所以不需要造用户、不写库；而"邮箱不存在"本身
   * 就是这条用例要的第五个 401 —— 限流不该挑请求的成败，只该数次数。
   */
  it('login 有独立额度：连打 6 次，第 6 次 429', async () => {
    const body = { email: 'nobody@example.com', password: 'pw123456' };

    for (let i = 0; i < 5; i += 1) {
      const res = await server().post('/auth/login').send(body).expect(401);
      expectErrorEnvelope(res.body, { code: 401 });
    }

    const res = await server().post('/auth/login').send(body).expect(429);

    expectErrorEnvelope(res.body, { code: 429 });
    expect(res.headers['retry-after']).toBeDefined();

    // 顺带钉住"429 也是信封形状" —— ThrottlerException extends HttpException，
    // 所以 CatchEverythingFilter 原样透传，不会掉进兜底分支变成一个裸 500。
    expect(JSON.stringify(res.body)).not.toContain('stack');
  });
});
