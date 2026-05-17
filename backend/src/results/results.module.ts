import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TestParticipation } from './test-participation.entity';
import { Submission } from '../submissions/submission.entity';
import { Test } from '../tests/test.entity';
import { Question } from '../questions/question.entity';
import { McqResponse } from '../test-session/mcq-response.entity';
import { ViolationLog } from '../test-session/violation-log.entity';
import { Paper } from '../paper/paper.entity';
import { StudentPaperSession } from '../paper/student-paper-session.entity';
import { ResultsService } from './results.service';
import { ResultsController } from './results.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TestParticipation, Submission, Test, Question, McqResponse, ViolationLog, Paper, StudentPaperSession])],
  controllers: [ResultsController],
  providers: [ResultsService],
  exports: [ResultsService],
})
export class ResultsModule {}
