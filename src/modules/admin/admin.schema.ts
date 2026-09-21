import { z } from 'zod';
import { todoSchema } from '../todos/todo.schema.js';
import { publicUserSchema } from '../users/user.schema.js';

/**
 * 管理员视角的 todo：比普通视角多一个 owner。
 *
 * ## owner 为什么要再 omit 掉 createdAt
 *
 * 因为 SQL 只 select 了三个字段：
 *
 * ```ts
 * include: { owner: { select: { id: true, email: true, role: true } } }
 * ```
 *
 * 而 `publicUserSchema` 是 `{ id, email, role, createdAt }` 四个。直接
 * `todoSchema.extend({ owner: publicUserSchema })` 等于让契约**索要一个查询
 * 根本没取的字段**，出口校验必然失败。
 *
 * 这不是假设。S9.2 的出口校验第一次跑起来就抓住了它：
 *
 * ```
 * GET /admin/todos → 500
 * Serialization failed: Invalid input: expected date, received undefined  (×5)
 * ```
 *
 * 5 条 todo 各报一次 —— 每个 owner 都缺 createdAt。
 *
 * ⚠️ 本文件旧版注释曾写「与 `select` 白名单严格对齐」，**那句话是错的**：
 * 当时就没有对齐，只是八个月里没有任何机制会发现它。这正是 S9.2 的意义 ——
 * 把契约从「文档上写着」变成「出口强制执行」，漂移会当场炸出来，
 * 而不是等你某天在前端发现少了个字段。
 *
 * ## 三种修法，这里选了第 2 种
 *
 * 1. 给 select 补 `createdAt: true` —— 契约不动，但**改变响应形状**（多一个字段），
 *    会动到前端 / Apifox 的既有预期；
 * 2. **把契约收窄到查询真正取到的字段**（当前做法）—— 响应形状不变，且语义更对：
 *    管理员看「这条 todo 是谁的」，不需要知道那个人什么时候注册的；
 * 3. 两处都改 —— 没有必要。
 *
 * 之所以放在 `admin/` 而不是塞进 `todo.schema.ts`：这个「todo + 归属人」的组合
 * 只有管理员视角需要，放到 todos 模块会让 todos 反向依赖 users 的 schema。
 */
export const adminTodoOwnerSchema = publicUserSchema.omit({ createdAt: true });

export const adminTodoSchema = todoSchema.extend({ owner: adminTodoOwnerSchema });

export type AdminTodo = z.infer<typeof adminTodoSchema>;
