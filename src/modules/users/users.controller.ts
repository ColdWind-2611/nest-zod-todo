import { Controller } from '@nestjs/common';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // 目前没有路由：user 相关的读接口暂时由 /auth/me（取自己）和
  // /admin/*（管理员视角）覆盖。留作后续扩展点（如 /users/:id 的公开资料）。
}
