import { Injectable, NotFoundException } from '@nestjs/common';
import { type CreateTodoDto, type UpdateTodoDto } from './todo.schema.js';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class TodosService {
  constructor(private prisma: PrismaService) {}

  create(userId: number, createTodoDto: CreateTodoDto) {
    return this.prisma.todo.create({
      data: {
        title: createTodoDto.title,
        ownerId: userId, // 归属只认 token 里的 userId，不认 body
      },
    });
  }

  async getTodos(
    userId: number,
    page: number,
    pageSize: number,
    done?: boolean,
  ) {
    const where = {
      ownerId: userId,
      ...(done !== undefined && { done }),
    };

    const [items, total] = await Promise.all([
      this.prisma.todo.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.todo.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(id: number, userId: number) {
    const todo = await this.prisma.todo.findFirst({
      where: { id, ownerId: userId },
    });
    if (!todo) throw new NotFoundException(`Todo #${id} 不存在`);
    return todo;
  }

  async update(id: number, userId: number, updateTodoDto: UpdateTodoDto) {
    // updateMany + { id, ownerId }：一次查询同时完成“存在性 + 归属”两道校验
    const res = await this.prisma.todo.updateMany({
      where: { id, ownerId: userId },
      data: updateTodoDto,
    });
    if (res.count === 0) throw new NotFoundException(`Todo #${id} 不存在`);
    return this.findOne(id, userId); // 回真正的更新后实体，而不是 { count: 1 }
  }

  async remove(id: number, userId: number) {
    const res = await this.prisma.todo.deleteMany({
      where: { id, ownerId: userId },
    });
    // 别人的 todo 和根本不存在的 todo 返回同一种错：
    // 不告诉调用方“这个 id 存在，只是不属于你”，避免用它探测数据
    if (res.count === 0) throw new NotFoundException(`Todo #${id} 不存在`);
    return res;
  }
}
