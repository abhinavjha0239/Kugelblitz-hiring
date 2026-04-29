import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

export type PdfIngestionJobData = {
  uploadId: string;
};

@Injectable()
export class PdfIngestionProducer {
  private readonly logger = new Logger(PdfIngestionProducer.name);

  constructor(
    @InjectQueue('pdf-ingestion')
    private readonly queue: Queue,
  ) {}

  async enqueueUpload(data: PdfIngestionJobData): Promise<string> {
    const job = await this.queue.add('parse-pdf', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: 200,
      removeOnFail: 100,
    });
    this.logger.log(`Queued PDF ingestion job ${job.id} for upload ${data.uploadId}`);
    return String(job.id);
  }
}
