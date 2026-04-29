import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum PdfUploadStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  PREVIEW_READY = 'preview_ready',
  PARTIAL = 'partial',
  FAILED = 'failed',
  CONFIRMED = 'confirmed',
}

export type ParsedPdfQuestion = {
  text: string;
  options: [string, string, string, string];
  correctOption: number | null;
  module: 'aptitude' | 'critical' | 'psychometric';
  status: 'valid' | 'invalid';
  issues: string[];
};

@Entity('pdf_uploads')
export class PdfUpload {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'file_name' })
  fileName: string;

  @Column({ name: 'file_path' })
  filePath: string;

  @Column({ type: 'enum', enum: PdfUploadStatus, default: PdfUploadStatus.QUEUED })
  @Index()
  status: PdfUploadStatus;

  @Column({ name: 'created_by_id' })
  @Index()
  createdById: string;

  @Column({ type: 'text', nullable: true })
  extractedText: string | null;

  @Column({ type: 'json', nullable: true })
  parsedQuestions: ParsedPdfQuestion[] | null;

  @Column({ type: 'json', nullable: true })
  stats: {
    total: number;
    valid: number;
    invalid: number;
    duplicatesRemoved: number;
  } | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'integer', default: 0 })
  progress: number;

  @Column({ type: 'varchar', name: 'saved_test_id', nullable: true })
  savedTestId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
