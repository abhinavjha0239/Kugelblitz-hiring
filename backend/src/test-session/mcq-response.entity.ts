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
import { Question } from '../questions/question.entity';
import { TestParticipation } from '../results/test-participation.entity';

@Entity('mcq_responses')
@Unique(['participationId', 'questionId'])
export class McqResponse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'participation_id' })
  @Index()
  participationId: string;

  @ManyToOne(() => TestParticipation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'participation_id' })
  participation: TestParticipation;

  @Column({ name: 'user_id' })
  @Index()
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'question_id' })
  @Index()
  questionId: string;

  @ManyToOne(() => Question)
  @JoinColumn({ name: 'question_id' })
  question: Question;

  @Column({ type: 'varchar', name: 'selected_option' })
  selectedOption: string;

  @Column({ default: false, name: 'is_correct' })
  isCorrect: boolean;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, name: 'marks_awarded' })
  marksAwarded: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
