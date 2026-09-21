import { z } from 'zod';

// 注册：密码强度卡在这里（8~72，上界是 bcrypt 的硬限制）
export const registerAuthSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(72),
});

// 登录：只要求非空，不重复注册的强度规则。
// 否则哪天把下限从 8 提到 12，所有老账号会连登录都进不来。
export const loginAuthSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

/**
 * 注册 / 登录的**统一出参**：只回 token，不回整条 user。
 *
 * 注意 register 也是回这个 —— 不是注册完顺带把用户对象给你。
 * 想知道"我是谁"，拿 token 打 `GET /auth/me`。
 */
export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
});

export type RegisterAuthDto = z.infer<typeof registerAuthSchema>;
export type LoginAuthDto = z.infer<typeof loginAuthSchema>;
export type TokenResponse = z.infer<typeof tokenResponseSchema>;
