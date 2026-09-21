/**
 * 把限流**重新打开**，只给 test/throttle.e2e-spec.ts 用。
 *
 * ★ 为什么这个小文件必须存在，而不是在用例的 `beforeAll` 里写一行 `process.env`：
 *
 * `ConfigModule.forRoot({ validate })` 里的 validate 是**同步**跑完的 ——
 * `forRoot` 里第一个 `await` 在 validate 之后（@nestjs/config/dist/config.module.js:52），
 * 所以 `AppModule` 被 **import 的那一刻** schema 就已经 parse 完、validated 配置就冻住了。
 * 而在 `beforeAll` 里改 process.env 时，`AppModule` 早就 import 完了 —— 太晚。
 * （ConfigService.get 的优先级是 internalConfig → validated env → process.env，
 *   冻住的那份赢。）
 *
 * 所以唯一能改的时间窗是「setupFiles 跑完」到「AppModule 被 import」之间，也就是
 * **测试文件自己第一行的 import**。ESM 按 import 语句的书写顺序求值，所以：
 *
 *     import './setup-throttle.js';        // ← 这条先跑，把开关翻回 true
 *     import { setupE2eApp } from './e2e-helpers.js';  // ← 这条才牵出 AppModule
 *
 * ⚠️ 这两行的**先后不能调换**。调换了会怎样：开关停在 setup-e2e.ts 设的 'false'，
 *    限流被整个跳过 → 本文件所有 429 断言一次性变红。**是响亮地红，不是静默假绿**，
 *    这一点是选这个方案的前提 —— 会静默失效的机制不能用来当测试基建。
 *
 * 谁把这行删了、或者把 import 挪到后面，跑一次 `pnpm test:e2e` 就知道了。
 */
process.env.RATE_LIMIT_ENABLED = 'true';
