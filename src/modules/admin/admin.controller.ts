import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service.js';
import { adminTodoSchema } from './admin.schema.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import {
  queryTodoSchema,
  type QueryTodoDto,
} from '../../common/schemas/pagination.schema.js';
import { idParamSchema } from '../../common/schemas/params.schema.js';
import { paginated, deleteResultSchema } from '../../common/schemas/response.schema.js';
import { Serialize } from '../../common/decorators/serialize.decorator.js';
import { ApiErrorResponses } from '../../common/decorators/apiErrorResponses.decorator.js';
import { BEARER_AUTH_NAME } from '../../config/swagger.config.js';

/**
 * RBAC 演示面：整个 controller 都要求 ADMIN。
 *
 * `@Roles` 标在 **class 上**而不是逐个方法上，是因为 RoleGuard 用
 * `getAllAndOverride([handler, class])` 读取 —— 方法级标注会覆盖类级，
 * 所以将来某个接口想放开给普通用户，只需在那个方法上写 @Roles('USER')。
 */
@ApiTags('admin')
@ApiBearerAuth(BEARER_AUTH_NAME)
@Controller('admin')
@Roles('ADMIN')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /** 看所有人的 todo（带归属人），普通用户打这里应当 403 */
  @Get('todos')
  @ApiOperation({
    summary: '所有人的 todo（带归属人）',
    description:
      '和 GET /todos 的差别有两处：① 范围是所有人而非仅自己；② 每条多一个 owner 字段。' +
      '对应的出参 schema 是 adminTodoSchema = todoSchema + owner，' +
      'owner 是 publicUserSchema 再 omit 掉 createdAt —— 因为 SQL 只 select 了 ' +
      '{ id, email, role }，契约与查询取到的字段严格一致（见 admin.schema.ts 的说明）。',
  })
  @Serialize(paginated(adminTodoSchema))
  @ApiErrorResponses(400, 401, 403)
  listTodos(@Query({ schema: queryTodoSchema }) query: QueryTodoDto) {
    const { page, pageSize, done } = query;
    return this.adminService.listAllTodos(page, pageSize, done);
  }

  /** 删任何人的 todo —— 对比 DELETE /todos/:id（只能删自己的） */
  @Delete('todos/:id')
  @ApiOperation({
    summary: '删任何人的 todo',
    description:
      'RBAC 模型：只看角色，不看归属。对比 DELETE /todos/:id 的归属模型 —— ' +
      '两个模型各占一个端点，不要叠在同一个接口里。',
  })
  @Serialize(deleteResultSchema)
  @ApiErrorResponses(400, 401, 403, 404)
  removeTodo(@Param('id', { schema: idParamSchema }) id: number) {
    return this.adminService.removeAnyTodo(id);
  }
}
