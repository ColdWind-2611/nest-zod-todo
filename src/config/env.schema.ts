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

  // ★ 逗号串在这里就拆成数组，**不要**留到 enableCors 的调用点再 split。
  //
  // 因为 cors@2.8.6 的 configureOrigin 对**字符串** origin 走的是 "fixed origin" 分支：
  // 它压根不比对请求的 Origin，直接把这个值当 Access-Control-Allow-Origin 发出去。
  // 于是 `"a,b"` 会变成 ACAO: `a,b` —— 而浏览器按规范只接受 `*` 或**单个** origin，
  // 所以**白名单里的合法前端和外部恶意站点一起被拒**，而且从服务端日志上看
  // "CORS 生效了、非白名单确实被拒了"，是个会骗人的绿灯。
  //
  // 只有**数组 / 函数 / RegExp** 才走 isOriginAllowed() 并反射请求的 origin；
  // 不匹配时值为 false，被 applyHeaders 的 `if (header.value)` 丢掉，也就是
  // **不下发 ACAO** —— 这才是"白名单"三个字成立的机制。
  //
  // 放在 schema 里而不是调用点，一举三得：① `Env['CORS_ORIGINS']` 是 string[]，
  // 再被拼回字符串就是编译错误；② `.url()` 顺带堵掉 `CORS_ORIGINS="*"`
  // （裸 `*` 走 cors 的 `options.origin === '*'` 分支 → **ACAO 全开**）；
  // ③ 配错了是**启动即崩**，而不是线上静默放宽。
  //
  // ⚠️ 正因为数组走全等比较，绝不能让 `*` 被 split 成 `['*']` —— 那匹配不上任何
  // 真实 Origin，等于把通配符**静默变成"谁都不许"**。`.url()` 在这里是安全网。
  CORS_ORIGINS: z
    .string()
    .transform((raw) =>
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().url()).min(1, 'CORS_ORIGINS 至少要有 1 个 origin')),

  // 限流总开关。**故意不给 default** —— 它是安全开关，"必须显式表态"优于"猜个默认值"。
  //
  // ⚠️ 不能用 z.coerce.boolean()：它内部是 Boolean(v)，而 Boolean('false') === true
  //    —— 环境变量永远是字符串，配成 "false" 反而会把它**打开**。
  //    stringbool() 专门处理这个问题，它返回的本身就是 z.codec，两侧类型都对
  //    （in: string, out: boolean），正合本项目"用自己的 codec 描述真实运行时形状"的路子。
  RATE_LIMIT_ENABLED: z.stringbool(),
});
export type Env = z.infer<typeof envSchema>;
