import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard.js';
import { IS_PUBLIC_KEY } from '../decorators/isPublic.decorator.js';
import { JwtPayload } from '../schemas/jwt.schema.js';

/** 造一个最小可用的 ExecutionContext：只实现守卫真正会碰的那几个方法 */
function makeContext(request: Record<string, unknown> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  let jwtMock: { verifyAsync: ReturnType<typeof vi.fn> };
  let guard: AuthGuard;

  // 关键：guard 和 jwtMock 在同一生命周期里重建。
  // 若把 guard 放顶层，它会捕获到 beforeEach 重新赋值前的旧 jwtMock，
  // mockResolvedValue 就作用不到守卫用的那个 spy 上 —— 表现为
  // verifyAsync 返回 undefined，payload.id 抛 TypeError，被 catch 吞成 401。
  beforeEach(() => {
    jwtMock = { verifyAsync: vi.fn() };
    // Reflector 用真的 —— 它本身无依赖，mock 它等于没测元数据读取
    guard = new AuthGuard(jwtMock as unknown as JwtService, new Reflector());
  });

  it('Bearer 有效 token：放行并把 payload 挂到 request.user', async () => {
    const payload: JwtPayload = {
      id: 1,
      email: 'alice@example.com',
      role: 'USER',
    };
    jwtMock.verifyAsync.mockResolvedValue(payload);

    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer good.token' },
    };

    const result = await guard.canActivate(makeContext(request));

    expect(result).toBe(true);
    expect(request.user).toEqual(payload);
    // 顺带钉住"剥掉 Bearer 前缀"这一步：传进 verifyAsync 的必须是裸 token
    expect(jwtMock.verifyAsync).toHaveBeenCalledWith('good.token');
  });

  it('无 Authorization 头：抛 401，且不走到验签', async () => {
    const request: Record<string, unknown> = { headers: {} };

    await expect(
      guard.canActivate(makeContext(request)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtMock.verifyAsync).not.toHaveBeenCalled();
  });

  it('Basic 前缀：抛 401，且不走到验签', async () => {
    const request: Record<string, unknown> = {
      headers: { authorization: 'Basic abc' },
    };

    await expect(
      guard.canActivate(makeContext(request)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtMock.verifyAsync).not.toHaveBeenCalled();
  });

  it('token 验签失败：抛 401', async () => {
    jwtMock.verifyAsync.mockRejectedValue(new Error('bad signature'));

    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer bad.token' },
    };

    await expect(
      guard.canActivate(makeContext(request)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    // 证明真的走了验签分支（而不是碰巧被别的 TypeError 吞成 401）
    expect(jwtMock.verifyAsync).toHaveBeenCalledTimes(1);
  });

  it('@Public()：无 token 也放行，且不走到验签', async () => {
    // 等价于给这个函数贴了 @Public()
    const handler = () => undefined;
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);

    // 注意：request 里没有 authorization 头
    const ctx = {
      ...makeContext({}),
      getHandler: () => handler,
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    // 这两句才是这条用例的真正价值：
    // 钉住"@Public 检查发生在读 token / 验签之前"的顺序语义。
    // 如果有人把它挪到验签之后，即便这次没 token 侥幸通过，
    // verifyAsync 也会被调用，下面这行必红。
    expect(jwtMock.verifyAsync).not.toHaveBeenCalled();
  });
});
