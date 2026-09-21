import {
  PipeTransform,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Zod 校验管道（手搓版）。
 *
 * ⚠️ **当前项目里已不再使用它** —— S9 之后统一改用 Nest 12 内置的
 * `StandardSchemaValidationPipe`（在 `main.ts` 里全局注册）。这个文件保留下来
 * 是为了对照：两者**行为等价**，写成同一份错误格式
 * （`['字段: 原因', ...]` + `BadRequestException(string[])`），
 * 所以 `CatchEverythingFilter` 对两者产出的 400 都不需要改。
 *
 * 内置版多做的事：校验前 `stripProtoKeys()`，删掉 body 里的
 * `__proto__` / `prototype` / `constructor`（原型链污染防御）。
 * 少做的事：没有 `safeParse` 的 `issues` 对象，只拿得到 `StandardSchemaV1.Issue[]`。
 *
 * ---
 *
 * schema 有**两个来源**，优先级：构造时显式传入 > 装饰器元数据。
 *
 *   // 写法 A（旧）：schema 作为参数塞进 pipe
 *   @Body(new ZodValidationPipe(registerAuthSchema)) dto: RegisterAuthDto
 *
 *   // 写法 B（Nest 12，推荐）：schema 声明在装饰器上
 *   @Body({ schema: registerAuthSchema }) dto: RegisterAuthDto
 *
 * 为什么推荐 B：`@Body({ schema })` 会把 schema 存进 ROUTE_ARGS_METADATA，
 * 运行时由 Nest core 作为 `ArgumentMetadata.schema` 传给管道（见
 * @nestjs/core/router/router-execution-context.js:167），**同一份元数据**
 * 又被 @nestjs/swagger 读走生成文档。于是"校验用的 schema"和"文档用的 schema"
 * 天然是同一个对象，不可能漂移 —— 而写法 A 里 Swagger 看不到 schema，
 * 文档上就是一片 "No parameters"，这正是 S9 修掉的 bug。
 *
 * 写法 A 仍有一个用处：给某个参数临时换一个更严的 schema，而不动装饰器上的声明。
 * 若哪天需要，把这里改成 `extends StandardSchemaValidationPipe` 再覆写
 * `formatIssueMessages` 即可，不必从零写。
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema?: ZodType) {}

  transform(value: unknown, metadata: ArgumentMetadata) {
    // metadata.schema 的类型是 StandardSchemaV1（框架不绑定具体库），
    // 本项目已定稿只用 Zod，这里断言成 ZodType 以便拿到 safeParse 的富错误信息。
    const schema = this.schema ?? (metadata.schema as ZodType | undefined);

    // 两处都没给 schema：这不是它的活，原样放行（是否必填由装饰器/路由决定）
    if (!schema) {
      return value;
    }

    const result = schema.safeParse(value);
    if (!result.success) {
      // 把 Zod 的 issues 明细抛出去（哪个字段、什么原因），别吞成一句 'Validation failed'
      const messages = result.error.issues.map((i) => {
        const path = i.path.join('.');
        return path ? `${path}: ${i.message}` : i.message;
      });
      throw new BadRequestException(messages);
    }
    return result.data; // ★ 返回"解析后的值"：含 coerce 强转、strip 剥离等转换结果
  }
}
