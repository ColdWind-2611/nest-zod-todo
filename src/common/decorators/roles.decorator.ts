import { SetMetadata } from '@nestjs/common';
import type { Role } from '../../prisma/generated/enums.js';

export const ROLES_KEY = 'roles';

/**
 * 声明访问该路由所需的角色，由 RoleGuard 用 Reflector 读取。
 *
 * 用法：`@Roles('ADMIN')`，或 `@Roles('ADMIN', 'USER')` 表示任一只需其一。
 * 标在 **class 上**表示该 controller 下所有路由都受此约束（handler 上的标注会覆盖它）。
 *
 * 命名注意：这里故意叫 `Roles`（复数）以区别于 Prisma 生成的 `Role` 类型 ——
 * 那是数据模型里的枚举，这是路由元数据装饰器，两者不该混为一谈。
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
