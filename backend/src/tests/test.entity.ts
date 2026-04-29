import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Question } from '../questions/question.entity';
import { TestParticipation } from '../results/test-participation.entity';
import { Paper } from '../paper/paper.entity';

@Entity('tests')
@Index('idx_tests_active_window', ['isActive', 'startsAt', 'endsAt'])
@Index('idx_tests_creator_created', ['createdById', 'createdAt'])
export class Test {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'duration_minutes' })
  durationMinutes: number;

  @Column({ default: false, name: 'is_active' })
  @Index()
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true, name: 'starts_at' })
  startsAt: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'ends_at' })
  endsAt: Date;

  @Column({ name: 'created_by_id' })
  createdById: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User;

  @OneToMany(() => Question, (q) => q.test, { cascade: true })
  questions: Question[];

  @OneToMany(() => TestParticipation, (tp) => tp.test)
  participations: TestParticipation[];

  @OneToMany(() => Paper, (paper) => paper.exam)
  papers: Paper[];

  @Column({ type: 'json', nullable: true, name: 'allowed_languages' })
  allowedLanguages: number[];

  @Column({ default: 0, name: 'total_marks' })
  totalMarks: number;

  // Section-based test: MCQ first, then Coding (unlocked on cutoff)
  @Column({ default: true, name: 'has_sections' })
  hasSections: boolean;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0, name: 'mcq_cutoff_percent' })
  mcqCutoffPercent: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0, name: 'negative_mark_value' })
  negativeMarkValue: number;

  @Column({ type: 'integer', default: 0, name: 'mcq_time_minutes' })
  mcqTimeMinutes: number;

  @Column({ type: 'integer', default: 0, name: 'coding_time_minutes' })
  codingTimeMinutes: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
