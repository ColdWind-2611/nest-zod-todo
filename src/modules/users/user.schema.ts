import { z } from 'zod';
import { Role } from '../../prisma/generated/enums.js';

// Role 直接复用 Prisma 生成出来的常量对象（as const），不再手写一份 TS enum：
// 以后往 schema.prisma 的 enum 里加值，这里自动跟着变，不会漂移。
export { Role };

// 基础字段（对应 Prisma 的 User model）
export const userSchema = z.object({
  id: z.int().positive(),
  email: z.email(),
  password: z.string().min(8).max(72), // bcrypt 只吃前 72 字节，超出部分被静默丢弃
  role: z.enum(Role),
  createdAt: z.date(),
});

// 出参专用：任何回给客户端的用户对象都从这里取，password 从类型层面就不存在
export const publicUserSchema = userSchema.omit({ password: true });

export type User = z.infer<typeof userSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
