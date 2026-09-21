import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import {
  type LoginAuthDto,
  loginAuthSchema,
  registerAuthSchema,
  type RegisterAuthDto,
  tokenResponseSchema,
} from './auth.schema.js';
import { Public } from '../../common/decorators/isPublic.decorator.js';
import { CurrentUser } from '../../common/decorators/currentUser.decorator.js';
import { Serialize } from '../../common/decorators/serialize.decorator.js';
import { ApiErrorResponses } from '../../common/decorators/apiErrorResponses.decorator.js';
import {
  jwtPayloadSchema,
  type JwtPayload,
} from '../../common/schemas/jwt.schema.js';
import { BEARER_AUTH_NAME } from '../../config/swagger.config.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Public()
  @ApiOperation({
    summary: '注册',
    description:
      '密码强度卡在 8~72（上界是 bcrypt 的硬限制，超出部分会被静默丢弃）。' +
      '注册成功**直接返回 token**，不用再调一次 login。',
  })
  @Serialize(tokenResponseSchema, {
    status: 201,
    description: '注册成功，token 可直接用于后续请求',
  })
  @ApiErrorResponses(400, 409)
  register(
    // 注意这里不再有 `pipes: [new ZodValidationPipe(registerAuthSchema)]`：
    // schema 挂在装饰器上，由 main.ts 里的全局管道统一执行。
    @Body({ schema: registerAuthSchema }) registerAuthDto: RegisterAuthDto,
  ) {
    return this.authService.register(registerAuthDto);
  }

  @Post('login')
  @HttpCode(200)
  @Public()
  @ApiOperation({
    summary: '登录',
    description:
      '登录密码只要求非空，不重复注册的强度规则 —— 否则哪天把下限从 8 提到 12，' +
      '所有老账号会连登录都进不来。失败与「用户不存在」返回同一句错误（防用户枚举）。',
  })
  // Nest 对**所有** POST 默认返回 201（`core/router/router-response-controller.js`
  // 的 `getStatusByMethod`），所以上面的 `@HttpCode(200)` 是必须的：登录只读不建资源，
  // 201 Created 语义不对。
  //
  // ★ `status` 必须和真实状态码一致，否则 Swagger 上标的和实际返回的打两岔
  // —— 而 `@Serialize` 的 `status` 正是喂给 `@ApiResponse` 的。
  // 改 `@HttpCode` 时记得同步这里。
  @Serialize(tokenResponseSchema, {
    status: 200,
    description: '登录成功，token 可直接用于后续请求',
  })
  @ApiErrorResponses(400, 401)
  login(@Body({ schema: loginAuthSchema }) loginAuthDto: LoginAuthDto) {
    return this.authService.login(loginAuthDto);
  }

  /**
   * 回的是 JWT 载荷本身（id / email / role），不是库里的完整 User。
   *
   * 只在方法上标 `@ApiBearerAuth` 而不是类上：register / login 是 @Public，
   * 在 Swagger UI 里给它们挂个锁头会误导人以为要先 Authorize。
   */
  @Get('me')
  @ApiBearerAuth(BEARER_AUTH_NAME)
  @ApiOperation({
    summary: '取当前登录用户',
    description: '直接把 token 里的载荷回给你 —— 它是签名过的，不用再查库。',
  })
  @Serialize(jwtPayloadSchema)
  @ApiErrorResponses(401)
  me(@CurrentUser() user: JwtPayload): JwtPayload {
    return user;
  }
}
