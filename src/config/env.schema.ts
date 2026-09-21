import * as z from 'zod';
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET 至少 32 字符，用 crypto.randomBytes(32) 生成'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
});
export type Env = z.infer<typeof envSchema>;
