import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Question } from './question.entity';
import { TestCase } from './test-case.entity';
import { QuestionsService } from './questions.service';
import { QuestionsController } from './questions.controller';
import { TestsModule } from '../tests/tests.module';

@Module({
  imports: [TypeOrmModule.forFeature([Question, TestCase]), TestsModule],
  controllers: [QuestionsController],
  providers: [QuestionsService],
  exports: [QuestionsService],
})
export class QuestionsModule {}
