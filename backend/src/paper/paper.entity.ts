import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Test } from '../tests/test.entity';
import { PaperQuestion } from './paper-question.entity';
import { StudentPaperSession } from './student-paper-session.entity';
import { decimalTransformer } from '../common/db/decimal-transformer';

@Entity('papers')
@Unique('uq_exam_order', ['examId', 'order'])
@Index('idx_exam_order', ['examId', 'order'])
export class Paper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'exam_id' })
  examId: string;

  @ManyToOne(() => Test, (test) => test.papers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exam_id' })
  exam: Test;

  @Column()
  name: string;

  @Column({ type: 'int' })
  order: number;

  @Column({ type: 'int', name: 'total_questions', default: 0 })
  totalQuestions: number;

  @Column({ type: 'int', name: 'duration_minutes', default: 30 })
  durationMinutes: number;

  @Column({ type: 'boolean', name: 'pass_required', default: false })
  passRequired: boolean;

  @Column({
    type: 'enum',
    enum: ['percent', 'marks', 'none'],
    default: 'none',
    name: 'cutoff_type',
  })
  cutoffType: 'percent' | 'marks' | 'none';

  @Column({ type: 'decimal', precision: 7, scale: 2, default: 0, name: 'cutoff_value', transformer: decimalTransformer })
  cutoffValue: number;

  @Column({
    type: 'enum',
    enum: ['end_exam', 'lock_next', 'none'],
    default: 'lock_next',
    name: 'cutoff_fail_behavior',
  })
  cutoffFailBehavior: 'end_exam' | 'lock_next' | 'none';

  @Column({ type: 'int', default: 0, name: 'total_marks' })
  totalMarks: number;

  @OneToMany(() => PaperQuestion, (pq) => pq.paper)
  questionLinks: PaperQuestion[];

  @OneToMany(() => StudentPaperSession, (session) => session.paper)
  sessions: StudentPaperSession[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

