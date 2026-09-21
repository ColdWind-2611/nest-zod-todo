import { z } from 'zod';

/**
 * 路径参数 `:id` 的 schema。
 *
 * 它干两件事：
 *
 * 1. **给 Swagger 看** —— 让 `:id` 在文档里是个 integer，而不是一个无类型的裸参数。
 *    这正是 S9 那个 "No parameters" bug 的修法：schema 必须挂在**参数装饰器**上
 *    （`@Param('id', { schema: idParamSchema })`），Swagger 才看得见。
 *    老写法 `@Param('id', new ZodValidationPipe(idParamSchema))` 把 schema 藏进了
 *    pipe 实例，`emitDecoratorMetadata` 又只能为 `z.infer` 类型别名反射出 `Object`，
 *    于是文档侧一无所知。
 *
 * 2. **运行时兜底约束** —— 由 main.ts 的全局 `StandardSchemaValidationPipe` 执行，
 *    保证 id 是正整数。注意 schema 里的 `z.coerce` 本身也会把 '12' 变成 12，
 *    所以 `ParseIntPipe` 严格来说是冗余的 —— 但它在**没注册全局管道**时是唯一的转型来源，
 *    留着它，这条链就不会因为某天漏了一行 `useGlobalPipes` 而断掉。
 *
 *    `@Param('id', { schema: idParamSchema, pipes: [ParseIntPipe] }) id: number`
 *    顺序上全局管道先跑（'12' → 12 且校验通过），ParseIntPipe 再拿到一个 number
 *    原样放行。各司其职、互不打架。
 */
export const idParamSchema = z.coerce.number().int().positive();
