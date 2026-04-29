import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../users/user.entity';
import { TestParticipation } from '../results/test-participation.entity';

export enum ViolationType {
  TAB_SWITCH = 'tab_switch',
  FULLSCREEN_EXIT = 'fullscreen_exit',
  COPY_PASTE = 'copy_paste',
  RAPID_ANSWER = 'rapid_answer',
  MULTIPLE_IP = 'multiple_ip',
}

@Entity('violation_logs')
@Index('idx_test_time', ['testId', 'createdAt'])
export class ViolationLog {
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

  @Column({ name: 'test_id' })
  @Index()
  testId: string;

  @Column({ type: 'enum', enum: ViolationType })
  type: ViolationType;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any> | null;

  @Column({ type: 'varchar', nullable: true, name: 'ip_address' })
  ipAddress: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
