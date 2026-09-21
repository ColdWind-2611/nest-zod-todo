import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { getRequestId } from '../middlewares/requestId.middleware.js';

@Catch()
export class CatchEverythingFilter implements ExceptionFilter {
  private readonly logger = new Logger(CatchEverythingFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    // httpAdapter 在某些情况下构造函数里拿不到，这里再解析一次
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();

    const httpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = this.resolveMessage(exception);

    // 未知异常：记录堆栈，但不返回给前端。
    // 日志必须带上 requestId —— 否则一次 500 在日志里是"孤岛"，
    // 无法和触发它的那次请求、以及同一请求里的其它日志串起来。
    if (!(exception instanceof HttpException)) {
      this.logger.error(
        `[${getRequestId() ?? '-'}] Unknown exception: ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const responseBody = {
      code: httpStatus,
      message,
      traceId: getRequestId() ?? randomUUID(),
    };

    httpAdapter.reply(ctx.getResponse(), responseBody, httpStatus);
  }

  /**
   * 把异常解析成对前端友好的 message。
   * 校验管道（S9 起是内置的 StandardSchemaValidationPipe）已保证校验错误
   * 是字符串数组，这里只需要兼容 string / string[] / 普通对象 三种情况。
   */
  private resolveMessage(exception: unknown): string | string[] {
    if (!(exception instanceof HttpException)) {
      return 'Internal Server Error';
    }

    const res = exception.getResponse();

    // 1. 直接是字符串：new HttpException('Forbidden', 403)
    if (typeof res === 'string') {
      return res;
    }

    // 2. 是对象：内置异常 / 自定义对象，看 message 字段
    if (res && typeof res === 'object' && 'message' in res) {
      const raw = (res as { message: unknown }).message;

      // 2a. 字符串数组：校验管道拍平后的结果（['title: 不能为空', ...]）
      if (Array.isArray(raw)) {
        return raw.map((item) => String(item));
      }

      // 2b. 单个字符串
      if (typeof raw === 'string') {
        return raw;
      }

      // 2c. 其它类型（数字、对象等）兜底成字符串
      return String(raw);
    }

    // 3. 兜底：用 HttpException 自身的 message
    return exception.message;
  }
}
