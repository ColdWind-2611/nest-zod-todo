import { z } from 'zod';

/**
 * 统一响应信封的 schema。
 *
 * 这里的形状必须和 TransformInterceptor / CatchEverythingFilter 的**实际输出逐字对应**。
 * 抽出来的意义就在这：信封一旦改形状，只改这一处，Swagger 文档跟着变，
 * 不会出现「文档写 A、接口返回 B」的漂移。
 */

/**
 * 成功：`{ code, message: 'OK', data }` —— 由 TransformInterceptor 产出。
 *
 * ★ `code` 现在等于**真实 HTTP 状态码**（拦截器读 `getResponse().statusCode`），
 * 不再是写死的 200。所以这个工厂**只描述 200 的端点**。
 * 非 200 的成功响应（比如注册的 201）别拿它凑数 —— 那样文档写 200、实际返 201，
 * 正是这个文件开头那句注释想防的漂移。
 * 真要描述 201，就在各自的 `@ApiResponse` 里自己拼一个 `z.literal(201)`。
 */
export const okEnvelope = <T extends z.ZodType>(data: T) =>
  z.object({
    code: z.literal(200),
    message: z.literal('OK'),
    data,
  });

/** 失败：{ code, message, traceId } —— 由 CatchEverythingFilter 产出 */
export const errorEnvelopeSchema = z.object({
  code: z.int().min(400),
  // 400 是数组（Zod 字段级明细），其余是字符串 —— 两种都要能表达
  message: z.union([z.string(), z.array(z.string())]),
  traceId: z.string(),
});

/** 分页信封：{ items, total, page, pageSize } —— 由 TodosService / AdminService 产出 */
export const paginated = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.int().nonnegative(),
    page: z.int().positive(),
    pageSize: z.int().positive(),
  });

/**
 * 删除出参：{ count } —— 由 `deleteMany` 的返回值直接透出。
 *
 * 保留 count 而不是回 204 空响应，是为了让"删了 1 条"和"啥也没删到"在出参上可区分；
 * 不过实际上删不到东西时 service 已经先抛 404 了，所以正常路径下 count 恒为 1。
 */
export const deleteResultSchema = z.object({
  count: z.int().nonnegative(),
});
