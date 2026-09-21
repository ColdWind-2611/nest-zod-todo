import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { Role } from '../../prisma/generated/enums.js';

/**
 * RBAC 守卫：比对 token 里的 role 与 @Roles() 声明的角色。
 *
 * 它和"归属校验"是**两种不同的授权模型**，别混：
 *   - 归属（ownership）：这资源是不是"我的" → 在 service 里用 ownerId 过滤
 *   - 角色（RBAC）：我有没有"这个系统能力" → 在这里用 role 判断
 *
 * 依赖顺序：必须排在 AuthGuard 之后 —— 它读的 request.user 是 AuthGuard 挂上去的。
 * 注册顺序见 auth.module.ts 的 APP_GUARD 数组。
 */
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // handler 上的 @Roles 优先于 class 上的（getAllAndOverride 的语义）
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 没标 @Roles 的路由不受角色约束（是否登录仍由 AuthGuard 负责）
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;

    // 走到这里还没有 user，说明 AuthGuard 没生效（例如该路由被标了 @Public）——
    // 这是配置错误，按 401 处理比按 403 更准确
    if (!user) {
      throw new UnauthorizedException();
    }

    if (!required.includes(user.role)) {
      throw new ForbiddenException(`需要 ${required.join(' / ')} 角色`);
    }

    return true;
  }
}
