import type { JwtPayload } from './common/schemas/jwt.schema.js';

/**
 * 给 Express 的 Request 补上 user 字段。
 *
 * 为什么必须声明在 `Request` 上而不是 `User` 上：
 * @types/express 只提供了 `Express.User` 这个空壳，**并没有**把它接到 `Request` 上
 * （真正做这件事的是 @types/passport，本项目不用 passport）。
 * 所以只写 `interface User { ... }` 是无效的 —— `req.user` 依旧是 any。
 *
 * 声明在这里之后：
 *   - `getRequest<Request>().user` 拿到的是真正的 JwtPayload 类型
 *   - `user.role` 被约束成 'USER' | 'ADMIN'，拼错会变成编译错误而不是运行时的 undefined
 */
declare global {
  namespace Express {
    interface Request {
      /** AuthGuard 校验通过后挂上的 JWT 载荷；@Public() 路由上为 undefined */
      user?: JwtPayload;
    }
  }
}
