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

  @OneToMany(() => PaperQuestion, (pq) => pq.paper)
  questionLinks: PaperQuestion[];

  @OneToMany(() => StudentPaperSession, (session) => session.paper)
  sessions: StudentPaperSession[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

