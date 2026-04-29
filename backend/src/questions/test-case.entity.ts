import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Question } from './question.entity';

@Entity('test_cases')
export class TestCase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'question_id' })
  @Index()
  questionId: string;

  @ManyToOne(() => Question, (q) => q.testCases, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question: Question;

  @Column({ type: 'text' })
  input: string;

  @Column({ type: 'text', name: 'expected_output' })
  expectedOutput: string;

  @Column({ default: false, name: 'is_hidden' })
  isHidden: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
