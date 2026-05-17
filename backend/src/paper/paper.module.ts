import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Paper } from './paper.entity';
import { PaperQuestion } from './paper-question.entity';
import { StudentPaperSession } from './student-paper-session.entity';
import { Question } from '../questions/question.entity';
import { PaperService } from './paper.service';
import { RandomizationService } from './randomization.service';
import { PaperSessionCacheService } from './paper-session-cache.service';
import { PaperAdminController } from './paper-admin.controller';
import { ExamSetModule } from '../exam-set/exam-set.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Paper, PaperQuestion, StudentPaperSession, Question]),
    forwardRef(() => ExamSetModule),
  ],
  providers: [PaperService, RandomizationService, PaperSessionCacheService],
  controllers: [PaperAdminController],
  exports: [PaperService, RandomizationService, PaperSessionCacheService, TypeOrmModule],
})
export class PaperModule {}

