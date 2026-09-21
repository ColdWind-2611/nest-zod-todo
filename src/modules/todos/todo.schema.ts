import { z } from 'zod';

// 实体：描述“从库里读出来的 todo 长什么样”
export const todoSchema = z.object({
  id: z.int().positive(),
  title: z.string().min(1).max(255),
  done: z.boolean(),
  createdAt: z.date(),
  ownerId: z.int().positive(),
});

// 建 todo：**没有 ownerId**。
// 归属只能从 JWT 推导，收客户端传的 ownerId 等于亲手开一个越权入口。
export const createTodoSchema = z
  .object({
    title: z.string().min(1).max(255),
  })
  .strict();

// 改 todo：title / done 都可选（原实现把 done 写死成 true，等于只能“标记完成”）
export const updateTodoSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    done: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.title !== undefined || v.done !== undefined, {
    message: '至少提供 title 或 done 之一',
  });

export type Todo = z.infer<typeof todoSchema>;

export type CreateTodoDto = z.infer<typeof createTodoSchema>;

export type UpdateTodoDto = z.infer<typeof updateTodoSchema>;
