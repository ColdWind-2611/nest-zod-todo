import { z } from 'zod';
import { Role } from '../../prisma/generated/enums.js';

/**
 * JWT 载荷的形状。
 *
 * 放 common/ 而不是 auth/ 是为了不制造 common → modules 的反向依赖：
 * 这里只依赖 Prisma 生成的 Role 常量，守卫/装饰器/auth 服务都能安全引用。
 *
 * 它同时是两件事的单一来源：
 *  1. 签发时（AuthService.signToken）—— 保证写进 token 的字段就是这几个
 *  2. 校验时（AuthGuard）—— 保证 token 被篡改/旧版本残留时不会悄悄流进业务代码
 */
export const jwtPayloadSchema = z.object({
  id: z.int().positive(),
  email: z.email(),
  role: z.enum(Role),
});

export type JwtPayload = z.infer<typeof jwtPayloadSchema>;
