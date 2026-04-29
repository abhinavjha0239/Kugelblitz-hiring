import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { Question, QuestionType } from '../questions/question.entity';
import {
  ParsedPdfQuestion,
  PdfUpload,
  PdfUploadStatus,
} from './pdf-upload.entity';
import { PdfIngestionProducer } from './pdf-ingestion.producer';
import { PdfParseService } from './pdf-parse.service';
import { ConfirmPdfUploadDto } from './dto/confirm-pdf-upload.dto';
import { TestsService } from '../tests/tests.service';

@Injectable()
export class PdfIngestionService {
  constructor(
    @InjectRepository(PdfUpload)
    private readonly uploadsRepo: Repository<PdfUpload>,
    @InjectRepository(Question)
    private readonly questionsRepo: Repository<Question>,
    private readonly producer: PdfIngestionProducer,
    private readonly parser: PdfParseService,
    private readonly testsService: TestsService,
  ) {}

  async createUpload(fileName: string, filePath: string, userId: string): Promise<PdfUpload> {
    const upload = await this.uploadsRepo.save(
      this.uploadsRepo.create({
        fileName,
        filePath,
        createdById: userId,
        status: PdfUploadStatus.QUEUED,
        progress: 5,
      }),
    );
    await this.producer.enqueueUpload({ uploadId: upload.id });
    return upload;
  }

  async getUpload(uploadId: string, userId: string): Promise<PdfUpload> {
    const upload = await this.uploadsRepo.findOne({
      where: { id: uploadId, createdById: userId },
    });
    if (!upload) throw new NotFoundException('Upload not found');
    return upload;
  }

  async processUpload(uploadId: string, job?: Job): Promise<void> {
    const upload = await this.uploadsRepo.findOne({ where: { id: uploadId } });
    if (!upload) throw new NotFoundException('Upload not found');

    try {
      await this.setProgress(upload, PdfUploadStatus.PROCESSING, 15, job);
      const extractedText = await this.parser.extractText(upload.filePath);

      if (!extractedText.trim()) {
        await this.uploadsRepo.update(uploadId, {
          status: PdfUploadStatus.FAILED,
          errorMessage: 'No readable text found in PDF. Use selectable text PDF or OCR before upload.',
          progress: 100,
        });
        return;
      }

      await this.uploadsRepo.update(uploadId, { extractedText, progress: 35 });
      if (job) await job.updateProgress(35);

      const llmQuestions = await this.parser.parseQuestions(extractedText);
      await this.uploadsRepo.update(uploadId, { progress: 65 });
      if (job) await job.updateProgress(65);

      const { normalized, duplicatesRemoved } = this.parser.validateAndNormalize(llmQuestions);
      const valid = normalized.filter((q) => q.status === 'valid').length;
      const invalid = normalized.length - valid;
      const status = valid > 0 && invalid > 0
        ? PdfUploadStatus.PARTIAL
        : valid > 0
          ? PdfUploadStatus.PREVIEW_READY
          : PdfUploadStatus.FAILED;

      await this.uploadsRepo.update(uploadId, {
        parsedQuestions: normalized,
        stats: {
          total: normalized.length,
          valid,
          invalid,
          duplicatesRemoved,
        },
        status,
        progress: 100,
        errorMessage: normalized.length ? null : 'Could not detect any MCQ questions in extracted text.',
      });
      if (job) await job.updateProgress(100);
    } catch (error: unknown) {
      await this.uploadsRepo.update(uploadId, {
        status: PdfUploadStatus.FAILED,
        progress: 100,
        errorMessage: error instanceof Error ? error.message : 'Unknown processing error',
      });
      throw error;
    }
  }

  async confirmUpload(userId: string, dto: ConfirmPdfUploadDto): Promise<{ inserted: number; testId: string }> {
    const upload = await this.getUpload(dto.uploadId, userId);
    const test = await this.testsService.findById(dto.testId);
    if (!test) throw new NotFoundException('Test not found');

    const selected = dto.questions || upload.parsedQuestions || [];
    const validQuestions = selected
      .map((q) => this.normalizePreviewQuestion(q))
      .filter((q) => q !== null) as ParsedPdfQuestion[];

    if (!validQuestions.length) {
      throw new BadRequestException('No valid questions to save');
    }

    const existing = await this.questionsRepo.count({ where: { testId: dto.testId } });
    const rows = validQuestions.map((q, index) =>
      this.questionsRepo.create({
        testId: dto.testId,
        type: QuestionType.MCQ,
        title: q.text.slice(0, 120),
        description: q.text,
        marks: 1,
        section: 1,
        orderIndex: existing + index,
        mcqOptions: q.options.map((text, i) => ({ id: String.fromCharCode(97 + i), text })),
        mcqCorrectAnswer:
          q.correctOption === null ? null : String.fromCharCode(97 + q.correctOption),
      }),
    );

    await this.questionsRepo.save(rows);
    await this.testsService.recalculateTotalMarks(dto.testId);
    await this.uploadsRepo.update(dto.uploadId, {
      status: PdfUploadStatus.CONFIRMED,
      savedTestId: dto.testId,
    });
    return { inserted: rows.length, testId: dto.testId };
  }

  private async setProgress(upload: PdfUpload, status: PdfUploadStatus, progress: number, job?: Job) {
    await this.uploadsRepo.update(upload.id, { status, progress });
    if (job) await job.updateProgress(progress);
  }

  private normalizePreviewQuestion(q: {
    text: string;
    options: string[];
    correctOption?: number | null;
    module?: string;
  }): ParsedPdfQuestion | null {
    const text = (q.text || '').trim();
    const options = (q.options || []).map((v) => (v || '').trim()).filter(Boolean);
    if (!text || options.length !== 4) return null;
    const correct =
      typeof q.correctOption === 'number' && q.correctOption >= 0 && q.correctOption <= 3
        ? q.correctOption
        : null;
    const module = q.module === 'critical' || q.module === 'psychometric' ? q.module : 'aptitude';
    return {
      text,
      options: [options[0], options[1], options[2], options[3]],
      correctOption: correct,
      module,
      status: 'valid',
      issues: [],
    };
  }
}
