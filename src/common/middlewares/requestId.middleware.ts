import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export const getRequestId = (): string | undefined =>
  requestContext.getStore()?.requestId;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // 客户端传来的可能为空、也可能是数组，统一处理
    const header = req.headers['x-request-id'];
    const incoming = Array.isArray(header) ? header[0] : header;

    const requestId =
      incoming && incoming.trim() !== '' ? incoming : randomUUID();

    // 回写到响应头，方便前端/网关关联
    res.setHeader('x-request-id', requestId);

    // 关键：用 run() 把后续整条调用链包进这个上下文
    requestContext.run({ requestId }, () => next());
  }
}
