import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PdfUpload } from './pdf-upload.entity';
import { PdfIngestionController } from './pdf-ingestion.controller';
import { PdfIngestionService } from './pdf-ingestion.service';
import { PdfIngestionProducer } from './pdf-ingestion.producer';
import { PdfIngestionProcessor } from './pdf-ingestion.processor';
import { PdfParseService } from './pdf-parse.service';
import { Question } from '../questions/question.entity';
import { TestsModule } from '../tests/tests.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'pdf-ingestion' }),
    TypeOrmModule.forFeature([PdfUpload, Question]),
    TestsModule,
  ],
  controllers: [PdfIngestionController],
  providers: [
    PdfIngestionService,
    PdfIngestionProducer,
    PdfIngestionProcessor,
    PdfParseService,
  ],
})
export class PdfIngestionModule {}
