import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Paper } from './paper.entity';
import { Question } from '../questions/question.entity';

@Entity('paper_questions')
@Unique('uq_paper_question_set', ['paperId', 'questionId', 'setId'])
@Index('idx_paper_question_lookup', ['paperId', 'questionId'])
@Index('idx_paper_set', ['paperId', 'setId'])
export class PaperQuestion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'paper_id' })
  paperId: string;

  @Column({ name: 'set_id', type: 'varchar', length: 36, nullable: true })
  setId: string | null;

  @ManyToOne(() => Paper, (paper) => paper.questionLinks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'paper_id' })
  paper: Paper;

  @Column({ name: 'question_id' })
  questionId: string;

  @ManyToOne(() => Question, (question) => question.paperLinks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question: Question;

  @Column({ type: 'int', default: 0, name: 'sort_order' })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

