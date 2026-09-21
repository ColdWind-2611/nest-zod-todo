import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * 系统级（RBAC）视角的 todo 操作。
 *
 * 与 TodosService 的本质区别只有一个：**这里故意不按 ownerId 过滤**。
 *   - TodosService：我是谁 → 只能碰我的   （ownership / 防越权）
 *   - AdminService：我是什么角色 → 能碰所有人的（RBAC / 系统能力）
 *
 * 两种模型各占一个接口，边界才看得清。把 @Roles('ADMIN') 叠在面向用户的
 * DELETE /todos/:id 上，会让"用户管自己的"和"管理员管所有人"互相抵消 ——
 * 结果是普通用户删不掉自己的，管理员也删不掉别人的。
 */
@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async listAllTodos(page: number, pageSize: number, done?: boolean) {
    const where = { ...(done !== undefined && { done }) };

    const [items, total] = await Promise.all([
      this.prisma.todo.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        // 带上归属人信息方便管理员查看；白名单式 select，密码永远不出库
        include: { owner: { select: { id: true, email: true, role: true } } },
      }),
      this.prisma.todo.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /** 管理员可删任何人的 todo —— 这里**故意**不加 ownerId 过滤 */
  async removeAnyTodo(id: number) {
    const res = await this.prisma.todo.deleteMany({ where: { id } });
    if (res.count === 0) throw new NotFoundException(`Todo #${id} 不存在`);
    return res;
  }
}
