import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubmissionProducer } from './submission.producer';
import { SubmissionProcessor } from './submission.processor';
import { Submission } from '../submissions/submission.entity';
import { QuestionsModule } from '../questions/questions.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'submissions' }),
    TypeOrmModule.forFeature([Submission]),
    QuestionsModule,
  ],
  providers: [SubmissionProducer, SubmissionProcessor],
  exports: [SubmissionProducer],
})
export class QueueModule {}
