import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppService } from './app.service.js';
import { Public } from './common/decorators/isPublic.decorator.js';
import { okEnvelope } from './common/schemas/response.schema.js';

@ApiTags('app')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * 健康检查。
   *
   * ## 为什么需要 `@Public()`
   *
   * S6 给全站上了 `APP_GUARD`（`AuthGuard`）—— 默认**所有接口都要 token**，
   * 漏标 `@Public()` 的会被拦成 401。`GET /` 从那时起一直是 401：
   *
   *   - 它是**故意留着**的样本，用来演示"默认 fail-closed"确实在生效；
   *   - 也因此，S8 那个"`GET /` 泄漏 DATABASE_URL"的 bug **从未被匿名用户拿到过** ——
   *     没登录根本进不来（任何已登录用户倒是能拿到，所以那仍是真 bug，已修）。
   *
   * 现在标上 `@Public()`，是因为健康检查的语义就该是匿名可达的：
   * 负载均衡 / K8s 探针 / 监控打这个端点时**不会带 token**，401 会让它们判定服务已死。
   *
   * ⚠️ 代价有两个，都想清楚再拍：
   *   1. 失去上面那个"漏标就被拦"的活样本；
   *   2. 这个端点从此可被任何人探测（当前只回 `'Hello World!'`，无信息泄漏 ——
   *      但**以后往这里加东西要小心**，它会绕过全局鉴权）。
   */
  @Get()
  @Public()
  @ApiOperation({
    summary: '健康检查',
    description:
      '匿名可达（@Public），不需要 token —— 给负载均衡 / 探针用。' +
      '换 token 之前也是 401，那不是 bug，是 S6 的全局 AuthGuard 在生效。',
  })
  // 这里没有用 @Serialize，是因为出参是一个**字符串**：
  // 内置的 StandardSchemaSerializerInterceptor 只处理对象
  // （`isObject(response)` 为 false 时直接放行），对它下契约不会生效。
  // 与其挂一个不起作用的装饰器，不如只在文档侧声明。
  @ApiResponse({
    status: 200,
    description: '服务正常',
    // 外层信封由 TransformInterceptor 产出，所以这里包 okEnvelope
    standardSchema: okEnvelope(z.string()),
  })
  getHello(): string {
    return this.appService.getHello();
  }
}
