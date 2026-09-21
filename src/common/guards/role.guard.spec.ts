import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import {
  UnauthorizedException,
  ForbiddenException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleGuard } from './role.guard.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

function makeContext(request: Record<string, unknown> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

/**
 * 造一个"handler 上贴了 @Roles(roles)"的 context。
 * roles === undefined 表示"没贴装饰器"，要与"贴了 @Roles([])"区分开：
 * 前者应放行，后者语义上是"谁都进不去"。
 */
function ctxWithRoles(
  roles: readonly string[] | undefined,
  request: Record<string, unknown> = {},
): ExecutionContext {
  const handler = () => undefined;
  if (roles !== undefined) {
    Reflect.defineMetadata(ROLES_KEY, roles, handler);
  }
  return {
    ...makeContext(request),
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

describe('RoleGuard', () => {
  // RoleGuard 无外部依赖，直接 new 一个即可
  const guard = new RoleGuard(new Reflector());

  it('handler 未贴 @Roles：放行', () => {
    expect(guard.canActivate(ctxWithRoles(undefined, {}))).toBe(true);
  });

  it('角色匹配：放行', () => {
    const ctx = ctxWithRoles(['ADMIN'], { user: { id: 1, role: 'ADMIN' } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('角色不匹配：403 Forbidden', () => {
    const ctx = ctxWithRoles(['ADMIN'], { user: { id: 1, role: 'USER' } });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('贴了 @Roles 但 request.user 为空：401 而不是 403', () => {
    // 刻意设计：拿不到身份 = 401（你是谁？），
    // 拿到了但没权限 = 403（知道你是谁，但不让你进）。
    // 用 toThrow(UnauthorizedException) 而非裸 toThrow()，
    // 是因为这条用例存在的全部意义就是钉住"401 而非 403"这个选择。
    const ctx = ctxWithRoles(['ADMIN'], {}); // 没有 user 字段
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
