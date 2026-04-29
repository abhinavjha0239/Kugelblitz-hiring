import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TestSessionService } from './test-session.service';
import { TestSessionController } from './test-session.controller';
import { McqResponse } from './mcq-response.entity';
import { ViolationLog } from './violation-log.entity';
import { ActionLog } from './action-log.entity';
import { TestParticipation } from '../results/test-participation.entity';
import { Test } from '../tests/test.entity';
import { Question } from '../questions/question.entity';
import { Submission } from '../submissions/submission.entity';
import { QueueModule } from '../queue/queue.module';
import { Paper } from '../paper/paper.entity';
import { PaperQuestion } from '../paper/paper-question.entity';
import { StudentPaperSession } from '../paper/student-paper-session.entity';
import { PaperModule } from '../paper/paper.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      McqResponse,
      ViolationLog,
      ActionLog,
      TestParticipation,
      Test,
      Question,
      Submission,
      Paper,
      PaperQuestion,
      StudentPaperSession,
    ]),
    QueueModule,
    PaperModule,
  ],
  controllers: [TestSessionController],
  providers: [TestSessionService],
  exports: [TestSessionService],
})
export class TestSessionModule {}
