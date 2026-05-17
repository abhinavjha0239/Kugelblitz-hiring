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
  SEB_HEADER_MISSING = 'seb_header_missing',
  SEB_HEADER_MISMATCH = 'seb_header_mismatch',
  SEB_PREFLIGHT_FAILED = 'seb_preflight_failed',
  // Magic-link candidate tried to access a different candidate's test —
  // URL-bar manipulation, forged testId in body, stolen .seb file, etc.
  // Logged by InviteScopeGuard.
  OUT_OF_SCOPE_ACCESS = 'out_of_scope_access',
}

@Entity('violation_logs')
@Index('idx_test_time', ['testId', 'createdAt'])
export class ViolationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Nullable: violations like OUT_OF_SCOPE_ACCESS can fire before the
  // candidate has a participation row (they hit a guarded URL the moment
  // they receive the JWT).
  @Column({ name: 'participation_id', nullable: true })
  @Index()
  participationId: string | null;

  @ManyToOne(() => TestParticipation, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'participation_id' })
  participation: TestParticipation | null;

  @Column({ name: 'user_id' })
  @Index()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
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
