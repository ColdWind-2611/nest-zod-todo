import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { errorEnvelopeSchema } from '../schemas/response.schema.js';

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: '参数校验失败 —— Zod 的字段级明细在 message 数组里',
  401: '未登录，或 token 缺失 / 无效 / 已过期',
  403: '已登录但角色不足（RBAC 拦截）',
  404: '资源不存在；也可能存在但不属于你（故意不区分，避免被用来探测数据）',
  409: '唯一约束冲突，例如邮箱已被注册',
  500: '服务端未捕获异常 —— 堆栈只进服务端日志，用 traceId 对账',
};

/**
 * 文档用：声明该接口可能返回哪些**统一错误结构**。
 *
 * 运行时不需要它 —— 错误响应是 CatchEverythingFilter 一处兜底产出的，
 * 不存在「漏标就漏处理」的问题。这个装饰器纯粹是为了让 Swagger UI 上
 * 每个接口都能看到失败长什么样，联调时不用猜。
 *
 * 用法：`@ApiErrorResponses(400, 404)`，数量任意。
 */
export function ApiErrorResponses(...statuses: number[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: ERROR_DESCRIPTIONS[status] ?? '错误',
        standardSchema: errorEnvelopeSchema,
      }),
    ),
  );
}
