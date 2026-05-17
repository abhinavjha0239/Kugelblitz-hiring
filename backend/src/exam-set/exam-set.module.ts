import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExamSet } from './exam-set.entity';
import { ExamSetService } from './exam-set.service';
import { ExamSetController } from './exam-set.controller';
import { PaperQuestion } from '../paper/paper-question.entity';
import { Paper } from '../paper/paper.entity';
import { TestParticipation } from '../results/test-participation.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ExamSet, PaperQuestion, Paper, TestParticipation])],
  providers: [ExamSetService],
  controllers: [ExamSetController],
  exports: [ExamSetService, TypeOrmModule],
})
export class ExamSetModule {}
