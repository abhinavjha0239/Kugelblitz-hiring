import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MailService, InvitePayload } from './mail.service';
import { MAIL_QUEUE } from './mail.processor.constants';

@Processor(MAIL_QUEUE, { concurrency: parseInt(process.env.MAIL_WORKER_CONCURRENCY || '10', 10) })
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mail: MailService) {
    super();
  }

  async process(job: Job<InvitePayload>): Promise<{ delivered: boolean; senderUsed: string | null }> {
    const start = Date.now();
    const { to } = job.data;
    try {
      const result = await this.mail.sendInvite(job.data);
      const elapsed = Date.now() - start;
      if (result.delivered) {
        this.logger.log(`Sent invite to ${to} via ${result.senderUsed} in ${elapsed}ms`);
      }
      return result;
    } catch (err: any) {
      this.logger.warn(`Send to ${to} failed (attempt ${job.attemptsMade + 1}): ${err.message}`);
      throw err;
    }
  }
}
