import { Module } from '@nestjs/common';
import { TodosService } from './todos.service.js';
import { TodosController } from './todos.controller.js';

@Module({
  controllers: [TodosController],
  providers: [TodosService],
})
export class TodosModule {}
