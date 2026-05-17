import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { TestParticipation } from '../results/test-participation.entity';
import { Submission } from '../submissions/submission.entity';

export enum UserRole {
  ADMIN = 'admin',
  STUDENT = 'student',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  @Exclude()
  password: string | null;

  @Column({ type: 'varchar', length: 100, name: 'first_name', nullable: true })
  firstName: string | null;

  @Column({ type: 'varchar', length: 100, name: 'last_name', nullable: true })
  lastName: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  mobile: string | null;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.STUDENT })
  role: UserRole;

  @Column({ default: true, name: 'is_active' })
  isActive: boolean;

  @Column({ default: false, name: 'force_password_reset' })
  forcePasswordReset: boolean;

  @Column({ default: false, name: 'profile_complete' })
  profileComplete: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => TestParticipation, (tp) => tp.user)
  participations: TestParticipation[];

  @OneToMany(() => Submission, (s) => s.user)
  submissions: Submission[];
}
