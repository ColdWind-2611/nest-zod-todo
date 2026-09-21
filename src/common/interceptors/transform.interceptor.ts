import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map } from 'rxjs';

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      map((data) => ({
        code: ctx.switchToHttp().getResponse().statusCode,
        message: 'OK',
        data,
      })),
    );
  }
}
