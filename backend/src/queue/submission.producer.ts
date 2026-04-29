import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface SubmissionJobData {
  submissionId: string;
  userId: string;
  questionId: string;
  testId: string;
  sourceCode: string;
  languageId: number;
  isFinal: boolean;
}

@Injectable()
export class SubmissionProducer {
  private readonly logger = new Logger(SubmissionProducer.name);

  constructor(
    @InjectQueue('submissions')
    private submissionsQueue: Queue,
  ) {}

  async addSubmissionJob(data: SubmissionJobData): Promise<string> {
    const job = await this.submissionsQueue.add('evaluate', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    });

    this.logger.log(`Queued submission job ${job.id} for submission ${data.submissionId}`);
    return job.id as string;
  }
}
