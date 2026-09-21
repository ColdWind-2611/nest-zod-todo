import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/isPublic.decorator.js';
import { jwtPayloadSchema } from '../schemas/jwt.schema.js';
import type { Request } from 'express';
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException();
    }
    try {
      // 💡 Here the JWT secret key that's used for verifying the payload
      // is the key that was passed in the JwtModule
      // verifyAsync 只保证“签名是我们签的、没过期”，不保证载荷字段齐全。
      // 再走一遍 schema：token 结构变了（比如旧版本签发的）会在这里被拦下，
      // 而不是让 undefined 悄悄流进 service 变成越权或 500。
      const payload = jwtPayloadSchema.parse(
        await this.jwtService.verifyAsync(token),
      );
      // 💡 We're assigning the payload to the request object here
      // so that we can access it in our route handlers
      request['user'] = payload;
    } catch {
      throw new UnauthorizedException();
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
