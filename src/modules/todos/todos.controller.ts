import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TodosService } from './todos.service.js';
import {
  createTodoSchema,
  type CreateTodoDto,
  todoSchema,
  updateTodoSchema,
  type UpdateTodoDto,
} from './todo.schema.js';
import { CurrentUser } from '../../common/decorators/currentUser.decorator.js';
import type { JwtPayload } from '../../common/schemas/jwt.schema.js';
import {
  type QueryTodoDto,
  queryTodoSchema,
} from '../../common/schemas/pagination.schema.js';
import { idParamSchema } from '../../common/schemas/params.schema.js';
import {
  deleteResultSchema,
  paginated,
} from '../../common/schemas/response.schema.js';
import { Serialize } from '../../common/decorators/serialize.decorator.js';
import { ApiErrorResponses } from '../../common/decorators/apiErrorResponses.decorator.js';
import { BEARER_AUTH_NAME } from '../../config/swagger.config.js';

@ApiTags('todos')
@ApiBearerAuth(BEARER_AUTH_NAME)
@Controller('todos')
export class TodosController {
  constructor(private readonly todosService: TodosService) {}

  @Post()
  @ApiOperation({
    summary: '新建 todo',
    description:
      '归属（ownerId）只认 token 里的 userId，请求体里传 ownerId 会被 .strict() 直接 400 —— 这是 S7.1 堵掉的越权入口。',
  })
  @Serialize(todoSchema, { status: 201, description: '创建成功' })
  @ApiErrorResponses(400, 401)
  create(
    // schema 挂在装饰器上，Swagger 才看得见 —— 这就是修掉 "No parameters" 的那一行。
    // 校验由 main.ts 的全局 StandardSchemaValidationPipe 执行，不需要在这里再塞 pipes。
    @Body({ schema: createTodoSchema }) createTodoDto: CreateTodoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.todosService.create(user.id, createTodoDto);
  }

  @Get()
  @ApiOperation({
    summary: '我的 todo 列表（分页）',
    description:
      'page / pageSize 有默认值（1 / 5），都不传也能正常返回。done 只接受字符串 "true" / "false"（传 1 / 0 会 400）。',
  })
  @Serialize(paginated(todoSchema))
  @ApiErrorResponses(400, 401)
  async getTodos(
    @Query({ schema: queryTodoSchema }) query: QueryTodoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const { page, pageSize, done } = query;
    return this.todosService.getTodos(user.id, page, pageSize, done);
  }

  @Get(':id')
  @ApiOperation({ summary: '取单条 todo' })
  @Serialize(todoSchema)
  @ApiErrorResponses(400, 401, 404)
  findOne(
    // 两个各司其职：
    //   schema        → 只给 Swagger 看，把 :id 声明成 integer（否则 UI 上是个无类型裸参数）
    //   ParseIntPipe  → 运行时把 '12' 变成 12，保证进 service 的 id 一定是 number
    // 全局 Zod 管道也会按 idParamSchema 校验一遍（必须是正整数），两者不冲突。
    @Param('id', { schema: idParamSchema, pipes: [ParseIntPipe] }) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.todosService.findOne(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: '改 todo 的 title 或 done',
    description: '两者都可选，但不能一个都不给（schema 里有 refine 兜着）。',
  })
  @Serialize(todoSchema)
  @ApiErrorResponses(400, 401, 404)
  update(
    @Param('id', { schema: idParamSchema, pipes: [ParseIntPipe] }) id: number,
    @Body({ schema: updateTodoSchema }) updateTodoDto: UpdateTodoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.todosService.update(id, user.id, updateTodoDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '删自己的 todo',
    description:
      '只做**归属**校验（是不是我的）。要删任何人的，走 DELETE /admin/todos/:id —— 那里才是 RBAC。两个模型各占一个端点，别叠在一起。',
  })
  @Serialize(deleteResultSchema)
  @ApiErrorResponses(400, 401, 404)
  remove(
    @Param('id', { schema: idParamSchema, pipes: [ParseIntPipe] }) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.todosService.remove(id, user.id);
  }
}
