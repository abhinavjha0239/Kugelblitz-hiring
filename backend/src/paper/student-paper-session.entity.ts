import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { TestParticipation } from '../results/test-participation.entity';
import { Paper } from './paper.entity';

export enum StudentPaperSessionStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  SUBMITTED = 'submitted',
}

@Entity('student_paper_sessions')
@Unique('uq_session_paper', ['sessionId', 'paperId'])
@Index('idx_session_paper_status', ['sessionId', 'paperId', 'status'])
export class StudentPaperSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'session_id' })
  sessionId: string;

  @ManyToOne(() => TestParticipation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: TestParticipation;

  @Column({ name: 'paper_id' })
  paperId: string;

  @ManyToOne(() => Paper, (paper) => paper.sessions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'paper_id' })
  paper: Paper;

  @Column({
    type: 'enum',
    enum: StudentPaperSessionStatus,
    default: StudentPaperSessionStatus.NOT_STARTED,
  })
  status: StudentPaperSessionStatus;

  @Column({ type: 'timestamp', nullable: true, name: 'started_at' })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'submitted_at' })
  submittedAt: Date | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  score: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

