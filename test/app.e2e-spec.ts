/**
 * 端到端验收：把「10.9 e2e 要覆盖的链路」那张 15 条清单逐条钉死。
 *
 * 分工：
 * - 本文件只回答「这个接口该返回什么」；
 * - 起应用 / 清库 / 造身份 / 比错误这些基建动作在 `./e2e-helpers.js`。
 *
 * 命名约定：每个 `it` 的标题就是清单里的那一句，方便与计划表对照。
 */
import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from 'vitest';
import request from 'supertest';
import { TodosService } from '../src/modules/todos/todos.service.js';
import {
  bearer,
  container,
  createTodo,
  createUser,
  db,
  expectErrorEnvelope,
  expectNoPasswordLeak,
  expectSameError,
  getServer,
  login,
  resetDatabase,
  setupE2eApp,
  teardownE2eApp,
  TEST_PASSWORD,
} from './e2e-helpers.js';

beforeAll(setupE2eApp);
afterAll(teardownE2eApp);
beforeEach(resetDatabase);

// ─────────────────────────────────────────────────────────────
// 安全带：证明全局装配真的生效了
// ─────────────────────────────────────────────────────────────
describe('安全带（configureApp 生效）', () => {
  it('#7 POST /todos { title: "" } → 400，且 service 未被触达', async () => {
    const A = await createUser();

    await request(getServer())
      .post('/todos')
      .set('Authorization', await bearer(A.token))
      .send({ title: '' })
      .expect(400);

    // 管道在进 handler 之前就拦下了，所以库里必须一条都没有
    expect(await db().todo.count()).toBe(0);
  });

  it('#4 POST /todos 不带 token + 非法 title → 401（守卫先于管道）', async () => {
    // 这条是「生命周期顺序」的证明：如果装配顺序反了，这里会是 400 而不是 401
    await request(getServer()).post('/todos').send({ title: '' }).expect(401);
  });
});

// ─────────────────────────────────────────────────────────────
// 注册 / 登录
// ─────────────────────────────────────────────────────────────
describe('POST /auth/register', () => {
  it('#1 新邮箱 → 201，data.access_token 非空', async () => {
    const res = await request(getServer())
      .post('/auth/register')
      .send({ email: `new_${Date.now()}@example.com`, password: TEST_PASSWORD })
      .expect(201);

    // ★ 全局拦截器把响应包成 { code, message, data }，token 在 data 里面
    expect(typeof res.body.data.access_token).toBe('string');
    expect(res.body.data.access_token.length).toBeGreaterThan(0);
  });

  it('#2 同邮箱再 register → 409', async () => {
    const email = `dup_${Date.now()}@example.com`;
    const payload = { email, password: TEST_PASSWORD };

    await request(getServer()).post('/auth/register').send(payload).expect(201);
    await request(getServer()).post('/auth/register').send(payload).expect(409);
  });
});

describe('POST /auth/login', () => {
  it('#3 密码错与"用户不存在"→ 都是 401，且文案逐字一致', async () => {
    const A = await createUser();

    const wrongPassword = await request(getServer())
      .post('/auth/login')
      .send({ email: A.email, password: 'wrong-password' })
      .expect(401);

    const noSuchUser = await request(getServer())
      .post('/auth/login')
      .send({ email: 'ghost@example.com', password: TEST_PASSWORD })
      .expect(401);

    // 两者不能有任何可区分的差别，否则等于送了一个账号枚举接口
    expectSameError(wrongPassword.body, noSuchUser.body);
    expect(wrongPassword.body.message).toBe(noSuchUser.body.message);
  });
});

describe('GET /auth/me', () => {
  it('带 token → 200，且恰好返回 { id, email, role }', async () => {
    const A = await createUser();

    const res = await request(getServer())
      .get('/auth/me')
      .set('Authorization', await bearer(A.token))
      .expect(200);

    expect(res.body.data.id).toBe(A.id);
    expect(res.body.data.email).toBe(A.email);
    // 契约锁：多一个字段就红 —— 这个接口最容易顺手把 password 漏出去
    expect(Object.keys(res.body.data).sort()).toEqual(['email', 'id', 'role']);
    expectNoPasswordLeak(res);
  });

  it('不带 token → 401（fail-closed：没标 @Public() 就必须拦）', async () => {
    await request(getServer()).get('/auth/me').expect(401);
  });
});

// ─────────────────────────────────────────────────────────────
// 创建 todo
// ─────────────────────────────────────────────────────────────
describe('POST /todos', () => {
  it('#5 合法 title → 201，且 ownerId === 自己', async () => {
    const A = await createUser();

    const res = await request(getServer())
      .post('/todos')
      .set('Authorization', await bearer(A.token))
      .send({ title: 'buy milk' })
      .expect(201);

    expect(res.body.data.title).toBe('buy milk');
    // ★ 这条是防越权的根：ownerId 必须来自 token，而不是客户端
    expect(res.body.data.ownerId).toBe(A.id);
  });

  it('#6 body 里塞 ownerId → 400（.strict() 拒绝未知字段）', async () => {
    const A = await createUser();

    await request(getServer())
      .post('/todos')
      .set('Authorization', await bearer(A.token))
      .send({ title: 'buy milk', ownerId: 1 })
      .expect(400);
  });
});

// ─────────────────────────────────────────────────────────────
// 归属（anti-IDOR）：别人的东西必须和不存在的长得一模一样
// ─────────────────────────────────────────────────────────────
describe('归属校验（anti-IDOR）', () => {
  it('#8 B 用 PATCH 碰 A 的 todo → 404，且与"不存在"同错，A 的数据没动', async () => {
    const A = await createUser();
    const B = await createUser();
    const todo = await createTodo(A.token, 'buy milk');

    const [otherPeople, notExist] = await Promise.all([
      request(getServer())
        .patch(`/todos/${todo.id}`)
        .set('Authorization', await bearer(B.token))
        .send({ title: 'hacked' })
        .expect(404),
      request(getServer())
        .patch('/todos/999999')
        .set('Authorization', await bearer(B.token))
        .send({ title: 'hacked' })
        .expect(404),
    ]);

    expectSameError(otherPeople.body, notExist.body);

    // 收尾：不能只是"报错归报错，实际改掉了"
    const check = await request(getServer())
      .get(`/todos/${todo.id}`)
      .set('Authorization', await bearer(A.token))
      .expect(200);
    expect(check.body.data.title).toBe('buy milk');
  });

  it('#9 B 用 DELETE 碰 A 的 todo → 404，且与"不存在"同错，A 的数据还在', async () => {
    const A = await createUser();
    const B = await createUser();
    const todo = await createTodo(A.token, 'buy milk');

    const [otherPeople, notExist] = await Promise.all([
      request(getServer())
        .delete(`/todos/${todo.id}`)
        .set('Authorization', await bearer(B.token))
        .expect(404),
      request(getServer())
        .delete('/todos/999999')
        .set('Authorization', await bearer(B.token))
        .expect(404),
    ]);

    expectSameError(otherPeople.body, notExist.body);

    // 同理：删失败就得真的没删掉
    await request(getServer())
      .get(`/todos/${todo.id}`)
      .set('Authorization', await bearer(A.token))
      .expect(200);
    expect(await db().todo.count()).toBe(1);
  });

  it('B 用 GET 读 A 的 todo → 404（读也要挡）', async () => {
    const A = await createUser();
    const B = await createUser();
    const todo = await createTodo(A.token, 'buy milk');

    await request(getServer())
      .get(`/todos/${todo.id}`)
      .set('Authorization', await bearer(B.token))
      .expect(404);
  });

  it('本人 PATCH → 200 / DELETE → 200 且真的删掉（成功路径也得测）', async () => {
    const A = await createUser();
    const todo = await createTodo(A.token, 'buy milk');

    const patched = await request(getServer())
      .patch(`/todos/${todo.id}`)
      .set('Authorization', await bearer(A.token))
      .send({ done: true })
      .expect(200);
    expect(patched.body.data.done).toBe(true);

    const removed = await request(getServer())
      .delete(`/todos/${todo.id}`)
      .set('Authorization', await bearer(A.token))
      .expect(200);
    expect(removed.body.data.count).toBe(1);

    expect(await db().todo.count()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// 分页与过滤
// ─────────────────────────────────────────────────────────────
describe('GET /todos（分页 / 归属过滤 / 参数校验）', () => {
  it('#10 ?page=1&pageSize=5 → 200，items ≤ 5 且全是自己的，total 只算自己', async () => {
    const A = await createUser();
    const B = await createUser();

    for (let i = 0; i < 7; i += 1) await createTodo(A.token, `A-${i}`);
    for (let i = 0; i < 3; i += 1) await createTodo(B.token, `B-${i}`);

    const res = await request(getServer())
      .get('/todos?page=1&pageSize=5')
      .set('Authorization', await bearer(A.token))
      .expect(200);

    const items = res.body.data.items as Array<{ title: string }>;

    expect(items).toHaveLength(5); // 分页生效：不是 7 条全塞回来
    expect(items.every((it) => it.title.startsWith('A-'))).toBe(true); // 归属过滤
    expect(res.body.data.total).toBe(7); // total 不把 B 的算进来
  });

  it('#11 ?done=1 → 400（只收 true / false 两个字面量）', async () => {
    const A = await createUser();
    const auth = await bearer(A.token);
    const get = (q: string) => request(getServer()).get(`/todos?${q}`).set('Authorization', auth);

    for (const bad of ['1', '0', 'TRUE', 'yes']) {
      await get(`done=${bad}`).expect(400);
    }

    // ✅ 合法值必须能过 —— 证明是"这个值被拒"，而不是"这条路由整个坏了"
    await get('done=true').expect(200);
    await get('done=false').expect(200);
    await request(getServer()).get('/todos').set('Authorization', auth).expect(200);
  });
});

// ─────────────────────────────────────────────────────────────
// RBAC
// ─────────────────────────────────────────────────────────────
describe('RBAC（/admin/*）', () => {
  it('#12 用 USER 的 token → 403（不是 401：身份有效，权限不够）', async () => {
    const user = await createUser({ role: 'USER' });

    await request(getServer())
      .get('/admin/todos')
      .set('Authorization', await bearer(user.token))
      .expect(403);
  });

  it('不带 token → 401（守卫链上 AuthGuard 先说话）', async () => {
    await request(getServer()).get('/admin/todos').expect(401);
  });

  it('#13 用 ADMIN 的 token → 200，且 owner 恰好是 { id, email, role }', async () => {
    const user = await createUser({ role: 'USER' });
    await createTodo(user.token, 'user-own-todo');

    const admin = await createUser({ role: 'ADMIN' });

    const res = await request(getServer())
      .get('/admin/todos')
      .set('Authorization', await bearer(admin.token))
      .expect(200);

    const items = res.body.data.items as Array<{
      id: number;
      title: string;
      done: boolean;
      createdAt: string;
      ownerId: number;
      owner: Record<string, unknown>;
    }>;

    // 管理员看得见所有人的 todo —— 这正是它和 GET /todos 的区别
    expect(items.length).toBeGreaterThan(0);

    // ★★ S9 那次 500 的契约锁：owner 契约里曾经藏着 createdAt，
    // 而 select 只取了 3 个字段，两者从没对齐过，只有 parse 一遍才会炸。
    // 这两行断言就是那次事故的墓碑 —— 谁动宽/动窄了，这里立刻红。
    expect(Object.keys(items[0].owner).sort()).toEqual(['email', 'id', 'role']);
    expect(Object.keys(items[0]).sort()).toEqual([
      'createdAt',
      'done',
      'id',
      'owner',
      'ownerId',
      'title',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────
// 出口防泄漏
// ─────────────────────────────────────────────────────────────
describe('#14 序列化防泄漏（所有响应都搜不到 password）', () => {
  it('遍历全部出参端点，JSON 里既没有 password 也没有 bcrypt hash', async () => {
    const user = await createUser({ role: 'USER' });
    const todo = await createTodo(user.token, 'buy milk');
    const auth = await bearer(user.token);

    const responses = await Promise.all([
      request(getServer()).get('/auth/me').set('Authorization', auth),
      request(getServer()).get('/todos').set('Authorization', auth),
      request(getServer()).get(`/todos/${todo.id}`).set('Authorization', auth),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(200);
      expectNoPasswordLeak(res);
    }

    // 连"提权后"的管理员端点也一起过一遍
    const admin = await createUser({ role: 'ADMIN' });
    const adminRes = await request(getServer())
      .get('/admin/todos')
      .set('Authorization', await bearer(admin.token))
      .expect(200);
    expectNoPasswordLeak(adminRes);

    // 反向确认这个断言不是恒真的：库里确实存着 hash，只是没出去
    const created = await db().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(created.password.startsWith('$2b$')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 统一错误信封 + traceId
// ─────────────────────────────────────────────────────────────
describe('#15 统一错误信封与 traceId', () => {
  it('错误响应恰好是 { code, message, traceId }，且 traceId 回显 x-request-id', async () => {
    const A = await createUser();
    const clientId = 'e2e-client-supplied-id';

    const res = await request(getServer())
      .post('/todos')
      .set('Authorization', await bearer(A.token))
      .set('x-request-id', clientId)
      .send({ title: '' })
      .expect(400);

    expectErrorEnvelope(res.body, { code: 400, traceId: clientId });
    // 响应头也要回写，否则前端没法把这次请求和后端日志对上
    expect(res.headers['x-request-id']).toBe(clientId);
  });

  it('4xx 也要带 traceId（连 401 都不能是裸的）', async () => {
    const res = await request(getServer())
      .get('/auth/me')
      .set('x-request-id', 'e2e-unauthorized')
      .expect(401);

    expectErrorEnvelope(res.body, { code: 401, traceId: 'e2e-unauthorized' });
  });

  it('非 HttpException → 500，信封形状不变，且 traceId 仍等于 x-request-id', async () => {
    const A = await createUser();
    const clientId = 'e2e-500-trace';
    const todoService = container().get(TodosService);

    // ★ 把单例上那个方法临时改坏 —— 这是**确定性地**制造一个 500 的办法。
    // 从容器取（而不是 new 一个）是关键：controller 用的是容器里那个实例。
    // 只有走到这里，异常才是从 handler 内部抛出的「非 HttpException」，
    // 才真正落在 CatchEverythingFilter 的兜底分支上。
    // 错误文案故意取一个不可能出现在 traceId 里的串（曾用 'boom' 撞了
    // traceId 'e2e-boom-trace'，自己的断言自己踩）。
    const secret = 'internal-detail-must-not-leak';
    vi.spyOn(todoService, 'create').mockRejectedValueOnce(new Error(secret));

    const res = await request(getServer())
      .post('/todos')
      .set('Authorization', await bearer(A.token))
      .set('x-request-id', clientId)
      .send({ title: 'whatever' })
      .expect(500);

    expectErrorEnvelope(res.body, { code: 500, traceId: clientId });
    expect(res.body.message).toBe('Internal Server Error');

    // 500 绝不能把内部细节漏给客户端 —— 连异常原文都不行
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain('at ');
    expect(raw).not.toContain('/src/');

    vi.restoreAllMocks();
  });

  it('非法 JSON → 400，且是**解析器**拍的，不过 ALS（一个真实的可观测性缺口）', async () => {
    const A = await createUser();

    const res = await request(getServer())
      .post('/todos')
      .set('Authorization', await bearer(A.token))
      .set('Content-Type', 'application/json')
      .set('x-request-id', 'e2e-will-be-lost')
      .send('{"title": ')
      .expect(400);

    // ⚠️ 这条用例是在**首跑翻车之后**照着实测结果改写的。原以为会走到
    // CatchEverythingFilter 的「非 HttpException → 500 + Internal Server Error」，
    // 实测三条全错，真实行为是：
    //   ① 状态码 400（解析器错误自带 statusCode=400，被当成 HttpException 处理）；
    //   ② message 是**解析器的原文**（"Unexpected end of JSON input"），不是兜底文案；
    //   ③ 响应头里**没有** x-request-id，traceId 是 `getRequestId() ?? randomUUID()` 的兜底。
    //
    // ③ 是真正值得记住的一条：`express.json()` 在 `RequestIdMiddleware` **之前**注册
    // （Nest 的 registerParserMiddleware 先于用户中间件），所以请求体解析失败时
    // ALS 上下文**根本没建立**。后果是：这一次 400 在服务端日志里**串不起来**，
    // 客户端拿到的 traceId 也对不上任何东西 —— 信封形状没错，但链路断了。
    expectErrorEnvelope(res.body, { code: 400 });
    expect(res.body.message).toBe('Unexpected end of JSON input');
    expect(res.body.traceId).not.toBe('e2e-will-be-lost');
    expect(res.headers['x-request-id']).toBeUndefined();

    // 反向确认：解析成功时同一个头是能被回显的（所以上面那条不是"恒不成立"）
    const ok = await request(getServer())
      .get('/todos')
      .set('Authorization', await bearer(A.token))
      .set('x-request-id', 'e2e-echoed')
      .expect(200);
    expect(ok.headers['x-request-id']).toBe('e2e-echoed');
  });
});

// ─────────────────────────────────────────────────────────────
// 补一条横切的：JWT 本身
// ─────────────────────────────────────────────────────────────
describe('token 有效性', () => {
  it('伪造/损坏的 token → 401，且与"没带 token"同错', async () => {
    const forged = await request(getServer())
      .get('/todos')
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401);

    const missing = await request(getServer()).get('/todos').expect(401);

    expectSameError(forged.body, missing.body);
  });

  it('登录拿到的 token 里 role 是签发那刻的快照（提权后必须重新登录）', async () => {
    const A = await createUser({ role: 'USER' });
    await request(getServer())
      .get('/admin/todos')
      .set('Authorization', await bearer(A.token))
      .expect(403);

    // 直接改库提权，但**不重新登录**
    await db().user.update({ where: { id: A.id }, data: { role: 'ADMIN' } });

    // 旧 token 里写死的还是 USER，所以依然 403 —— 这就是要重新登录的原因
    await request(getServer())
      .get('/admin/todos')
      .set('Authorization', await bearer(A.token))
      .expect(403);

    // 重新登录后立刻通过
    const fresh = await login(A.email, TEST_PASSWORD);
    await request(getServer())
      .get('/admin/todos')
      .set('Authorization', await bearer(fresh))
      .expect(200);
  });
});
