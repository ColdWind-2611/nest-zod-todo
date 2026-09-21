import { applyDecorators, SerializeOptions } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { ZodType } from 'zod';
import { okEnvelope } from '../schemas/response.schema.js';

/**
 * 声明一个接口的**出参契约**。一份 schema 同时驱动两件事：
 *
 *   1. 运行时 —— `StandardSchemaSerializerInterceptor`（Nest 12 内置，已在
 *      `app.module.ts` 注册）读这个 schema，parse handler 的返回值。
 *      `z.object` 默认 strip，多余字段被**剥掉**，这就是「出口白名单」：
 *      哪天 service 不小心把 `password` 或 `ownerId` 带出来，这里直接拦下。
 *   2. 文档   —— 同一个 schema 交给 `@ApiResponse` 的 `standardSchema`，
 *      由 `standardSchemaConverter` 转成 OpenAPI 片段。
 *
 * 这正是大纲 Session 9 那句「心智」：先定义契约，**文档和校验都从它长出来**。
 * 声明一次、两处生效，不存在「改了校验忘了改文档」的中间状态。
 *
 * ## 为什么是 `SerializeOptions` 而不是自造一个元数据键
 *
 * Nest 12 的序列化拦截器读的是 `CLASS_SERIALIZER_OPTIONS`
 * （`serializer/class-serializer.constants.js`，值是 `'class_serializer:options'`），
 * 由 `@SerializeOptions` 写入。自己 `SetMetadata('serialize:output_schema', ...)`
 * 不会报错，但拦截器读不到 —— 表现为**序列化静默失效**，比报错难查得多。
 *
 * 注意这个键和 `ClassSerializerInterceptor`（class-transformer 那套）**共用**。
 * 本项目不用 class-transformer，所以不冲突；哪天要用了，两边的 options 会互相覆盖。
 *
 * @param dataSchema 描述 **data 本身**的形状，不含外层 {code,message,data} 信封
 * @param options.status HTTP 状态码。POST 建资源是 201（Nest 对 POST 的默认值），别用 200
 */
export function Serialize<T extends ZodType>(
  dataSchema: T,
  options: { status?: number; description?: string } = {},
) {
  const { status = 200, description = '成功' } = options;

  return applyDecorators(
    SerializeOptions({ schema: dataSchema }),
    ApiResponse({
      status,
      description,
      standardSchema: okEnvelope(dataSchema),
    }),
  );
}
