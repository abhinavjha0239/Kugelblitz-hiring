import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Test } from '../tests/test.entity';

export enum ParticipationStatus {
  IN_PROGRESS = 'in_progress',
  SUBMITTED = 'submitted',
  TIMED_OUT = 'timed_out',
  RESET = 'reset',
}

@Entity('test_participations')
@Unique(['userId', 'testId', 'attemptNumber'])
@Index('idx_user_test', ['userId', 'testId'])
@Index('idx_test_status', ['testId', 'status'])
@Index('idx_started', ['startedAt'])
export class TestParticipation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  @Index()
  userId: string;

  @ManyToOne(() => User, (u) => u.participations)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'test_id' })
  @Index()
  testId: string;

  @ManyToOne(() => Test, (t) => t.participations)
  @JoinColumn({ name: 'test_id' })
  test: Test;

  @Column({ type: 'timestamp', name: 'started_at' })
  startedAt: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'submitted_at' })
  submittedAt: Date | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, name: 'total_score' })
  totalScore: number;

  @Column({ default: 0, name: 'tab_switch_count' })
  tabSwitchCount: number;

  @Column({ default: 0, name: 'fullscreen_exit_count' })
  fullscreenExitCount: number;

  @Column({
    type: 'enum',
    enum: ParticipationStatus,
    default: ParticipationStatus.IN_PROGRESS,
  })
  status: ParticipationStatus;

  // Section tracking
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, name: 'mcq_score' })
  mcqScore: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, name: 'coding_score' })
  codingScore: number;

  @Column({ default: false, name: 'mcq_submitted' })
  mcqSubmitted: boolean;

  @Column({ default: false, name: 'coding_unlocked' })
  codingUnlocked: boolean;

  @Column({ default: false, name: 'auto_submitted' })
  autoSubmitted: boolean;

  @Column({ type: 'varchar', default: 'mcq', name: 'current_section' })
  currentSection: string;

  @Column({ default: 0, name: 'risk_score' })
  riskScore: number;

  @Column({ default: 0, name: 'violation_count' })
  violationCount: number;

  @Column({ default: 0, name: 'copy_paste_count' })
  copyPasteCount: number;

  @Column({ type: 'varchar', nullable: true, name: 'ip_address' })
  ipAddress: string | null;

  @Column({ type: 'json', nullable: true, name: 'time_per_question' })
  timePerQuestion: Record<string, number>;

  @Column({ type: 'int', default: 1, name: 'attempt_number' })
  attemptNumber: number;

  @Column({ type: 'varchar', length: 36, nullable: true, name: 'reset_by' })
  resetBy: string | null;

  @Column({ type: 'timestamp', nullable: true, name: 'reset_at' })
  resetAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
