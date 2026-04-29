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
import { Test } from '../tests/test.entity';
import { TestCase } from './test-case.entity';
import { Submission } from '../submissions/submission.entity';
import { PaperQuestion } from '../paper/paper-question.entity';

export enum QuestionType {
  CODING = 'coding',
  MCQ = 'mcq',
}

@Entity('questions')
@Index('idx_test_section', ['testId', 'section'])
@Index('idx_test_order', ['testId', 'orderIndex'])
export class Question {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'test_id' })
  @Index()
  testId: string;

  @ManyToOne(() => Test, (t) => t.questions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'test_id' })
  test: Test;

  @Column({ type: 'enum', enum: QuestionType })
  type: QuestionType;

  @Column()
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ default: 10 })
  marks: number;

  @Column({ default: 0, name: 'order_index' })
  orderIndex: number;

  @Column({ type: 'json', nullable: true, name: 'allowed_languages' })
  allowedLanguages: number[];

  @Column({ type: 'json', nullable: true, name: 'mcq_options' })
  mcqOptions: { id: string; text: string }[] | null;

  @Column({ type: 'varchar', nullable: true, name: 'mcq_correct_answer' })
  mcqCorrectAnswer: string | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0, name: 'negative_marks' })
  negativeMarks: number;

  // Section: 1 = MCQ section, 2 = Coding section
  @Column({ type: 'integer', default: 1 })
  section: number;

  @OneToMany(() => TestCase, (tc) => tc.question, { cascade: true })
  testCases: TestCase[];

  @OneToMany(() => Submission, (s) => s.question)
  submissions: Submission[];

  @OneToMany(() => PaperQuestion, (pq) => pq.question)
  paperLinks: PaperQuestion[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
