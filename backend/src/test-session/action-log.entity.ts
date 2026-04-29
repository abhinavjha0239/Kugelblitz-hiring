import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum ActionEventType {
  LOGIN = 'login',
  LOGOUT = 'logout',
  TAB_SWITCH = 'tab_switch',
  FULLSCREEN_EXIT = 'fullscreen_exit',
  COPY_PASTE = 'copy_paste',
  RAPID_ANSWER = 'rapid_answer',
  MCQ_ANSWER = 'mcq_answer',
  CODE_SUBMIT = 'code_submit',
  TEST_START = 'test_start',
  TEST_SUBMIT = 'test_submit',
  PASSWORD_CHANGE = 'password_change',
}

@Entity('action_logs')
@Index('idx_session_time', ['sessionId', 'createdAt'])
@Index('idx_user', ['userId'])
@Index('idx_type_time', ['eventType', 'createdAt'])
export class ActionLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 36, nullable: true, name: 'session_id' })
  sessionId: string | null;

  @Column({ type: 'varchar', length: 36, name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 36, nullable: true, name: 'test_id' })
  testId: string | null;

  @Column({ type: 'enum', enum: ActionEventType, name: 'event_type' })
  eventType: ActionEventType;

  @Column({ type: 'json', nullable: true, name: 'event_data' })
  eventData: Record<string, any> | null;

  @Column({ type: 'varchar', length: 45, nullable: true, name: 'ip_address' })
  ipAddress: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
