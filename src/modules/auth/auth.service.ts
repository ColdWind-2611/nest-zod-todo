import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { RegisterAuthDto, LoginAuthDto } from './auth.schema.js';
import bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../prisma/generated/client.js';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '../../common/schemas/jwt.schema.js';
import { Env } from '../../config/env.schema.js';

@Injectable()
export class AuthService {
  constructor(
    private config: ConfigService<Env, true>,
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  private get saltRounds(): number {
    return this.config.get('BCRYPT_SALT_ROUNDS', { infer: true });
  }

  private signToken(payload: JwtPayload) {
    return this.jwtService.signAsync(payload);
  }

  async register(dto: RegisterAuthDto) {
    const hashedPassword = await bcrypt.hash(dto.password, this.saltRounds);

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          password: hashedPassword,
        },
        // 白名单式 select：password 从一开始就不会被查出来，杜绝手滑回传
        select: {
          id: true,
          email: true,
          role: true,
          createdAt: true,
        },
      });
    } catch (e) {
      // 唯一约束冲突是“预期内的业务失败”，不是程序故障。
      // 不接住它，Nest 的兜底过滤器会回 500 —— 那就等于把 409 说成了服务器崩了。
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('该邮箱已被注册');
      }
      throw e;
    }

    return {
      access_token: await this.signToken({
        id: user.id,
        email: user.email,
        role: user.role,
      }),
    };
  }

  async login(dto: LoginAuthDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    // 用户不存在 / 密码不对返回同一句话，不给撞库的人区分信号
    if (!user) throw new UnauthorizedException('邮箱或密码错误');
    const ok = await bcrypt.compare(dto.password, user.password);
    if (!ok) throw new UnauthorizedException('邮箱或密码错误');
    return {
      access_token: await this.signToken({
        id: user.id,
        email: user.email,
        role: user.role,
      }),
    };
  }
}
