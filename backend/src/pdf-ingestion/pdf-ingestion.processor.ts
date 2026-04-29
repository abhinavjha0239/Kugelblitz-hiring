import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PdfIngestionJobData } from './pdf-ingestion.producer';
import { PdfIngestionService } from './pdf-ingestion.service';

@Injectable()
@Processor('pdf-ingestion', { concurrency: 3 })
export class PdfIngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(PdfIngestionProcessor.name);

  constructor(private readonly ingestionService: PdfIngestionService) {
    super();
  }

  async process(job: Job<PdfIngestionJobData>): Promise<void> {
    this.logger.log(`Processing PDF ingestion for upload ${job.data.uploadId}`);
    await this.ingestionService.processUpload(job.data.uploadId, job);
  }
}
