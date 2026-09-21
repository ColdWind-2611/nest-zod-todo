import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '../schemas/jwt.schema.js';

/**
 * 取出当前登录用户。
 *
 * 注意拿到的是 **JWT 载荷**（{ id, email, role }），不是数据库里的完整 User ——
 * 它没有 password / createdAt，所以别把它当 User 用。
 * 想要完整记录，用 payload.id 回库查一次。
 */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtPayload =>
    ctx.switchToHttp().getRequest().user,
);
