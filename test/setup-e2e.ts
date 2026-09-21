import 'dotenv/config';
import 'reflect-metadata';

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  throw new Error('DATABASE_URL_TEST 未设置，检查 .env');
}
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';

// ── 下面两行都是"在应用被装配之前把期望值钉进 process.env" ──
//
// 生效机理（写在 .env.example 里那条规矩的另一半）：
//   ① setupFiles 在**测试文件被 import 之前**执行，所以这里的赋值一定早于
//      `import { AppModule }`；
//   ② @nestjs/config 的 assignVariablesToProcess 只在 `override: true` 时才覆盖
//      process.env 里已存在的键，我们没传 override ⇒ 这里的值赢；
//   ③ ConfigService.get 的优先级是 internalConfig → **validated env** → process.env，
//      而 validated env 就是 envSchema.parse 的产物，所以在 env.schema.ts 里
//      transform / 校验过的东西，最终就是 get() 拿到的东西。

// 限流总开关。**必须在这里关掉**，否则本项目的 e2e 会被自己挡住：
// 登录是 5 次/60 秒 + 封禁 300 秒，而 app.e2e-spec.ts 一共要登录约 27 次
// —— 第 6 次开始全是 429，后面 19 个用例连带变红。
//
// ⚠️ 想验"限流真的生效"的那一份在 test/throttle.e2e-spec.ts，它靠**自己文件第一行
//    的 import** 把这个值翻回 'true'（import 顺序就是执行顺序）。理由见那个文件。
process.env.RATE_LIMIT_ENABLED = 'false';

// CORS 白名单的期望值。**必须钉死**：它平时只写在被 gitignore 的 .env 里，
// 不钉的话 security.e2e-spec.ts 的断言就变成"取决于当前这台开发机的 .env"
// —— 换台机器/换个人 clone 下来就红，而且红得莫名其妙。
// 这是和 DATABASE_URL 完全同一套机制、同一个理由。
// 这三个字面量要和 test/security.e2e-spec.ts 里的断言保持一致。
process.env.CORS_ORIGINS = 'http://localhost:5173,https://allowed.example.com';
