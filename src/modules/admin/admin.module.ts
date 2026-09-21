import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

// PrismaModule 是 @Global 的，PrismaService 直接可注入，无需在这里 imports
@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
