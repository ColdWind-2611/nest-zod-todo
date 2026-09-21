import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TodosService } from './todos.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
function makePrismaMock() {
  return {
    todo: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

describe('TodosService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: TodosService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new TodosService(prisma as unknown as PrismaService);
    prisma.todo.findMany.mockResolvedValue([]);
    prisma.todo.count.mockResolvedValue(0);
  });

  it('ownerId 取自入参 userId', async () => {
    const created = { id: 1, title: 'buy milk', ownerId: 7, done: false };
    prisma.todo.create.mockResolvedValue(created);

    const result = await service.create(7, { title: 'buy milk' });

    expect(result).toBe(created); // 原样透传
    expect(prisma.todo.create).toHaveBeenCalledTimes(1);
    expect(prisma.todo.create).toHaveBeenCalledWith({
      data: { title: 'buy milk', ownerId: 7 },
    });
  });

  it('body 里硬塞 ownerId 也无效', async () => {
    prisma.todo.create.mockResolvedValue({ id: 1 });

    // CreateTodoDto 类型上没有 ownerId，用 as any 强行塞入模拟攻击
    await service.create(7, { title: 'x', ownerId: 999 } as never);

    expect(prisma.todo.create).toHaveBeenCalledWith({
      data: { title: 'x', ownerId: 7 }, // 仍是 7，不是 999
    });
  });

  it('where 里始终带 ownerId；不传 done 时 where 里没有 done', async () => {
    await service.getTodos(7, 1, 10);

    const expectedWhere = { ownerId: 7 };
    expect(prisma.todo.findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      skip: 0,
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
    expect(prisma.todo.count).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it('done=true 时 where 里带 done: true', async () => {
    await service.getTodos(7, 1, 10, true);
    expect(prisma.todo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: 7, done: true } }),
    );
  });

  it('done=false 时 where 里带 done: false（不能被 falsy 吞掉）', async () => {
    await service.getTodos(7, 1, 10, false);
    expect(prisma.todo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: 7, done: false } }),
    );
  });

  it('分页：page=3, pageSize=10 → skip=20, take=10', async () => {
    await service.getTodos(7, 3, 10);
    expect(prisma.todo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
  });

  it('返回 { items, total, page, pageSize }', async () => {
    const items = [{ id: 1 }, { id: 2 }];
    prisma.todo.findMany.mockResolvedValue(items);
    prisma.todo.count.mockResolvedValue(42);

    const result = await service.getTodos(7, 2, 10);

    expect(result).toEqual({ items, total: 42, page: 2, pageSize: 10 });
  });
  it('找到：返回 todo，且 where 同时含 id 和 ownerId', async () => {
    const todo = { id: 1, title: 'x', ownerId: 7, done: false };
    prisma.todo.findFirst.mockResolvedValue(todo);

    const result = await service.findOne(1, 7);

    expect(result).toBe(todo);
    expect(prisma.todo.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.todo.findFirst).toHaveBeenCalledWith({
      where: { id: 1, ownerId: 7 }, // ← 归属线的核心断言
    });
  });

  it('找不到：抛 NotFoundException', async () => {
    prisma.todo.findFirst.mockResolvedValue(null);

    await expect(service.findOne(1, 7)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('成功：updateMany 后回一次 findOne 拿真实体', async () => {
    const updated = { id: 1, title: 'new', ownerId: 7, done: true };
    prisma.todo.updateMany.mockResolvedValue({ count: 1 });
    prisma.todo.findFirst.mockResolvedValue(updated);

    const result = await service.update(1, 7, { title: 'new' });

    expect(result).toBe(updated); // 是真实体，不是 { count: 1 }
    expect(prisma.todo.updateMany).toHaveBeenCalledWith({
      where: { id: 1, ownerId: 7 },
      data: { title: 'new' },
    });

    // ⚠️ 这条才是单测的强项：断言"又调了一次 findOne"
    expect(prisma.todo.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.todo.findFirst).toHaveBeenCalledWith({
      where: { id: 1, ownerId: 7 },
    });
  });

  it('count=0：抛 NotFoundException，且不再调 findOne', async () => {
    prisma.todo.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.update(1, 7, { title: 'new' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.todo.findFirst).not.toHaveBeenCalled();
  });
  it('成功：返回 deleteMany 的结果', async () => {
    const res = { count: 1 };
    prisma.todo.deleteMany.mockResolvedValue(res);

    const result = await service.remove(1, 7);

    expect(result).toBe(res);
    expect(prisma.todo.deleteMany).toHaveBeenCalledWith({
      where: { id: 1, ownerId: 7 },
    });
  });

  it('count=0：抛 NotFoundException', async () => {
    prisma.todo.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.remove(1, 7)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('错误文案与 findOne 完全相同（不泄漏"存在但不属于你"）', async () => {
    prisma.todo.deleteMany.mockResolvedValue({ count: 0 });
    prisma.todo.findFirst.mockResolvedValue(null);

    const removeErr = await service.remove(1, 7).catch((e) => e);
    const findErr = await service.findOne(1, 7).catch((e) => e);

    expect(removeErr).toBeInstanceOf(NotFoundException);
    expect(findErr).toBeInstanceOf(NotFoundException);
    expect((removeErr as Error).message).toBe((findErr as Error).message);
  });
});
