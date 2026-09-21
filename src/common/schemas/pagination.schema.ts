import { z } from 'zod';
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(5),
});
export type PaginationDto = z.infer<typeof paginationSchema>;

/**
 * `?done=true|false` → boolean。
 *
 * 用 `z.codec(in, out)` 而不是 `.transform()`，是为了让**输出侧也能被转成 OpenAPI 片段**。
 * `@Serialize(schema)` 会同时写运行时序列化元数据和 `@ApiResponse.standardSchema`，
 * 后者在应用**启动时**由 `createDocument()` 转 output 方向；而 `.transform()` 在 output 侧
 * 没有可表示的 JSON Schema，zod-openapi 会直接抛错 —— 也就是「加个 @Serialize 就起不来」。
 *
 * 为什么不用它报错信息里推荐的 `.overwrite()`：`.overwrite(fn: (value: T) => T)` 要求
 * in/out 同类型，而这里必然要从 `'true' | 'false'` 变成 `boolean`（得写 `as never` 才编译得过），
 * 且生成出的 output 仍是 `{"type":"string","enum":["true","false"]}` ——
 * 对一个运行时其实是 boolean 的字段**撒谎**。
 * `.meta({ type: 'boolean' })` 更糟：它会把**输入侧**也变成 boolean，请求文档从此说错。
 * `z.codec` 是唯一两侧都成立的写法：input = string enum（查询串本来就是字符串），
 * output = boolean（转换后的真实类型）。
 */
export const doneSchema = z
  .codec(z.enum(['true', 'false']), z.boolean(), {
    decode: (v) => v === 'true',
    // encode 目前没人调用，但 codec 要求成对提供；将来要把布尔回写进查询串时才用得上。
    encode: (v) => (v ? 'true' : 'false'),
  })
  .optional();

export const queryTodoSchema = paginationSchema.extend({ done: doneSchema });
export type QueryTodoDto = z.infer<typeof queryTodoSchema>;
