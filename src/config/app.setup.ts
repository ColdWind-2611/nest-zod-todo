import {
  type INestApplication,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { setupSwagger } from './swagger.config.js';

export function configureApp(app: INestApplication) {
  // ⚠️ 这一行不是可选项 —— 少了它，下面所有 `@Body({ schema })` 都会**静默不校验**。
  //
  // `{ schema }` 只是把 schema 挂成参数元数据（`metadata.schema`），它本身不执行任何逻辑。
  // 真正去读这份元数据、跑校验的，是管道。挂元数据不注册管道 = 文档有了、校验没有，
  // 危险程度高于两者都没有：Swagger UI 上写着 "required / minLength: 8"，
  // 实际却什么都能塞进去。
  //
  // 用内置的而不是自己写一个，是因为它多做了一件手搓版没做的事：
  // 校验前先 `stripProtoKeys()`，删掉 body 里的 `__proto__` / `prototype` / `constructor`
  // （原型链污染防御）。错误消息格式两者一致，都是 `['字段: 原因', ...]`。
  //
  // 注册成「全局」而非逐参数 `pipes: [new ZodValidationPipe()]`：全局是**漏不掉**的，
  // 新增接口只要写了 `{ schema }` 就自动被校验；逐参数写法一旦忘了写那串 pipes，
  // 就退化成上面说的「有文档、没校验」。安全默认值应当是 fail-safe 而不是 fail-open。
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  // 生产环境想关掉文档的话：`if (process.env.NODE_ENV !== 'production') setupSwagger(app);`
  // 文档在测试里没有意义，且 createDocument 要扫全部元数据、会拖慢每个 e2e 文件，
  // 所以只在真实启动时挂。
  if (process.env.NODE_ENV !== 'test') {
    setupSwagger(app);
  }
}
