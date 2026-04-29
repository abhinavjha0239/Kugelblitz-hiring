import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Question } from '../questions/question.entity';
import { Test } from '../tests/test.entity';

export enum SubmissionStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('submissions')
@Index('idx_user_test_status', ['userId', 'testId', 'status'])
export class Submission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  @Index()
  userId: string;

  @ManyToOne(() => User, (u) => u.submissions)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'question_id' })
  @Index()
  questionId: string;

  @ManyToOne(() => Question, (q) => q.submissions)
  @JoinColumn({ name: 'question_id' })
  question: Question;

  @Column({ name: 'test_id' })
  @Index()
  testId: string;

  @ManyToOne(() => Test)
  @JoinColumn({ name: 'test_id' })
  test: Test;

  @Column({ name: 'language_id' })
  languageId: number;

  @Column({ type: 'longtext', name: 'source_code' })
  sourceCode: string;

  @Column({ type: 'enum', enum: SubmissionStatus, default: SubmissionStatus.QUEUED })
  status: SubmissionStatus;

  @Column({ type: 'json', nullable: true })
  result: Record<string, any> | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  score: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true, name: 'execution_time' })
  executionTime: number | null;

  @Column({ type: 'integer', nullable: true, name: 'memory_used' })
  memoryUsed: number | null;

  @Column({ default: false, name: 'is_final' })
  isFinal: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
