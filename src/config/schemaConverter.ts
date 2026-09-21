import type { StandardSchemaConverter } from '@nestjs/swagger';
import type { ZodType } from 'zod';
import { createSchema } from 'zod-openapi';

/**
 * Zod → OpenAPI 片段的转换器。
 *
 * ## 为什么必须有它（而不是白拿内置的）
 *
 * `@nestjs/swagger` v12 内置了 `StandardSchemaOpenApiConverter`，它会直接问 schema 要
 * `~standard.jsonSchema[input|output]({ target: 'openapi-3.0' })`，而 Zod 4.6 确实原生
 * 实现了 `~standard.jsonSchema`。看起来什么都不用做 —— 但**实测会炸**：
 *
 * ```
 * z.object({ createdAt: z.date() })  → 抛出
 * Error: Date cannot be represented in JSON Schema
 *   at Module.dateProcessor (zod/v4/core/json-schema-processors.js:232)
 * ```
 *
 * 原因是 JSON Schema 里**没有日期类型**，Zod 的转换器选择「不可表示就抛异常」。
 * 而本项目的 `todoSchema` / `publicUserSchema` 都带 `createdAt: z.date()`，
 * 于是 `SwaggerModule.createDocument()` 会在**启动时**直接崩掉整个应用。
 *
 * `zod-openapi` 对同一个 schema 的处理是降级成 `{ type: 'string' }` ——
 * 这恰好是对的：JSON 传输里 Date 本来就是一个 ISO 字符串，文档没撒谎。
 *
 * ## 它是怎么被调用的
 *
 * `standard-schema-openapi.converter.js:28` 先问这个自定义转换器：
 *
 * ```js
 * const customSchema = this.schemaConverter?.(schema, { schemaType });
 * if (customSchema) { return this.normalizeCustomConvertedSchema(customSchema); }
 * // 只有返回 undefined/undefined 才回落到内置的 ~standard.jsonSchema
 * ```
 *
 * 也就是说这里是**替换**而不是叠加：我们返回了结果，内置那条路就不会走。
 * 所以二者不会打架，也不需要 `patchNestJsSwagger()` 之类的猴补丁。
 *
 * @param schema 参数装饰器上的 `{ schema }`，或 `@ApiResponse({ standardSchema })` 传进来的 Zod schema
 * @param schemaType `input` = 请求侧（body/query/param），`output` = 响应侧。
 *   同一份 `z.object` 在两侧的 JSON Schema 可能不同（默认值、transform 只影响一侧）。
 */
export const zodOpenApiConverter: StandardSchemaConverter = (
  schema,
  { schemaType },
) => {
  const { schema: jsonSchema, components } = createSchema(schema as ZodType, {
    io: schemaType,
    openapiVersion: '3.0.0',
  });

  // components 是一个「名字 → schema」的扁平表，键就是 schema 上 `.meta({ id })` 的名字。
  // 本项目目前没给任何 schema 起 id，所以恒为 {}。
  // 一旦给公共子 schema 起了 id，引用它的地方会变成
  // `{ $ref: '#/components/schemas/UserBase' }`，这里就得把表交出去，
  // 否则 Swagger UI 上会看到一个悬空的 $ref（点开是空的）。
  return { schema: jsonSchema, components };
};
