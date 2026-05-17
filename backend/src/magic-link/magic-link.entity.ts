import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Test } from '../tests/test.entity';
import { User } from '../users/user.entity';

export enum MagicLinkStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUBMITTED = 'submitted',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

@Entity('magic_links')
@Unique('uq_magic_token', ['token'])
@Index('idx_magic_email_test', ['email', 'testId'])
export class MagicLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 128 })
  token: string;

  @Column()
  email: string;

  @Column({ name: 'test_id' })
  testId: string;

  @ManyToOne(() => Test, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'test_id' })
  test: Test;

  @Column({ name: 'user_id', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ type: 'varchar', length: 36, nullable: true, name: 'set_id' })
  setId: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'prefill_first_name' })
  prefillFirstName: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'prefill_last_name' })
  prefillLastName: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'prefill_mobile' })
  prefillMobile: string | null;

  @Column({ type: 'timestamp', name: 'valid_from' })
  validFrom: Date;

  @Column({ type: 'timestamp', name: 'valid_until' })
  validUntil: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'used_at' })
  usedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'submitted_at' })
  submittedAt: Date | null;

  @Column({
    type: 'enum',
    enum: MagicLinkStatus,
    default: MagicLinkStatus.PENDING,
  })
  status: MagicLinkStatus;

  // Per-link Browser Exam Key for SEB. Generated lazily on first .seb config
  // download. SEB 3.5+ derives the EFFECTIVE BEK as HMAC-SHA256(bek_bytes,
  // salt_bytes) before hashing requests, so we store both BEK and salt on
  // the link and use the same pair for verification. Per-link (not per-test)
  // so a leaked .seb only compromises one candidate.
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'seb_browser_exam_key' })
  sebBrowserExamKey: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'seb_exam_key_salt' })
  sebExamKeySalt: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
