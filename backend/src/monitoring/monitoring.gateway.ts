import { Logger, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Server, Socket } from 'socket.io';
import { TestParticipation, ParticipationStatus } from '../results/test-participation.entity';
import { User, UserRole } from '../users/user.entity';
import { Paper } from '../paper/paper.entity';
import { StudentPaperSession } from '../paper/student-paper-session.entity';

export interface AttendeeSnapshot {
  userId: string;
  email: string;
  name: string;
  participationId: string;
  status: string;
  setId: string | null;
  startedAt: string;
  riskScore: number;
  tabSwitchCount: number;
  fullscreenExitCount: number;
  copyPasteCount: number;
  totalScore: number;
  currentPaperId: string | null;
  currentPaperName: string | null;
  currentQuestionIndex: number | null;
  totalQuestionsInPaper: number | null;
  paperStartedAt: string | null;
  lastEventAt: string;
}

@WebSocketGateway({
  namespace: 'monitoring',
  cors: { origin: true, credentials: true },
})
export class MonitoringGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(MonitoringGateway.name);

  @WebSocketServer()
  server: Server;

  // Track current question per (testId, userId) — populated from autosave events.
  private currentQuestionMap = new Map<string, { idx: number; total: number }>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(TestParticipation)
    private readonly participationsRepo: Repository<TestParticipation>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Paper)
    private readonly papersRepo: Repository<Paper>,
    @InjectRepository(StudentPaperSession)
    private readonly paperSessionsRepo: Repository<StudentPaperSession>,
  ) {}

  // ─── Auth ──────────────────────────────────────────────
  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.query?.token;
      if (!token) {
        this.logger.warn(`Monitor socket ${client.id} rejected: no token`);
        client.disconnect(true);
        return;
      }
      const payload: any = await this.jwt.verifyAsync(String(token), {
        secret: this.config.get<string>('jwt.secret'),
      });
      if (payload.role !== UserRole.ADMIN) {
        this.logger.warn(`Monitor socket ${client.id} rejected: not admin`);
        client.disconnect(true);
        return;
      }
      client.data.userId = payload.sub;
      this.logger.log(`Monitor socket connected: admin=${payload.email}`);
    } catch (err: any) {
      this.logger.warn(`Monitor socket ${client.id} rejected: ${err.message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Monitor socket disconnected: ${client.id}`);
  }

  // ─── Subscribe to a test ───────────────────────────────
  @SubscribeMessage('subscribe')
  async onSubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { testId: string }) {
    if (!body?.testId) return { error: 'testId required' };
    const room = roomFor(body.testId);
    await client.join(room);
    const snapshot = await this.buildSnapshot(body.testId);
    client.emit('snapshot', { testId: body.testId, attendees: snapshot });
    return { ok: true, count: snapshot.length };
  }

  @SubscribeMessage('unsubscribe')
  async onUnsubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { testId: string }) {
    if (!body?.testId) return;
    await client.leave(roomFor(body.testId));
    return { ok: true };
  }

  // ─── Snapshot builder ──────────────────────────────────
  private async buildSnapshot(testId: string): Promise<AttendeeSnapshot[]> {
    const participations = await this.participationsRepo.find({
      where: { testId, status: ParticipationStatus.IN_PROGRESS },
      order: { startedAt: 'DESC' },
    });
    if (participations.length === 0) return [];
    const userIds = participations.map((p) => p.userId);
    const users = await this.usersRepo.find({ where: { id: anyOf(userIds) } as any });
    const userById = new Map(users.map((u) => [u.id, u]));

    // Bulk-load all paper sessions for these participations in ONE query
    // (was N+1: one find per participation in the loop below).
    const participationIds = participations.map((p) => p.id);
    const allSessions = participationIds.length
      ? await this.paperSessionsRepo.find({
          where: { sessionId: anyOf(participationIds) } as any,
          relations: ['paper'],
        })
      : [];
    const sessionsByParticipation = new Map<string, typeof allSessions>();
    for (const s of allSessions) {
      const arr = sessionsByParticipation.get(s.sessionId) ?? [];
      arr.push(s);
      sessionsByParticipation.set(s.sessionId, arr);
    }

    const result: AttendeeSnapshot[] = [];
    for (const p of participations) {
      const u = userById.get(p.userId);
      const sessions = sessionsByParticipation.get(p.id) ?? [];
      const inProgress = sessions.find((s) => s.status === 'in_progress');
      const currentPaper = inProgress?.paper ?? null;
      const cqKey = `${testId}:${p.userId}`;
      const cq = this.currentQuestionMap.get(cqKey);
      result.push({
        userId: p.userId,
        email: u?.email ?? '(unknown)',
        name: [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.email || 'Candidate',
        participationId: p.id,
        status: p.status,
        setId: p.setId,
        startedAt: new Date(p.startedAt).toISOString(),
        riskScore: p.riskScore || 0,
        tabSwitchCount: p.tabSwitchCount || 0,
        fullscreenExitCount: p.fullscreenExitCount || 0,
        copyPasteCount: p.copyPasteCount || 0,
        totalScore: Number(p.totalScore || 0),
        currentPaperId: currentPaper?.id ?? null,
        currentPaperName: currentPaper?.name ?? null,
        currentQuestionIndex: cq?.idx ?? null,
        totalQuestionsInPaper: cq?.total ?? currentPaper?.totalQuestions ?? null,
        paperStartedAt: inProgress?.startedAt ? new Date(inProgress.startedAt).toISOString() : null,
        lastEventAt: new Date().toISOString(),
      });
    }
    return result;
  }

  // ─── Public emit helpers (called from services) ────────
  emitToTest(testId: string, event: string, payload: any) {
    if (!this.server) return;
    this.server.to(roomFor(testId)).emit(event, { testId, ...payload });
  }

  async pushAttendeeUpdate(testId: string, userId: string) {
    const p = await this.participationsRepo.findOne({ where: { testId, userId } });
    if (!p) return;
    const u = await this.usersRepo.findOne({ where: { id: userId } });
    const sessions = await this.paperSessionsRepo.find({
      where: { sessionId: p.id },
      relations: ['paper'],
    });
    const inProgress = sessions.find((s) => s.status === 'in_progress');
    const currentPaper = inProgress?.paper ?? null;
    const cqKey = `${testId}:${userId}`;
    const cq = this.currentQuestionMap.get(cqKey);
    const attendee: AttendeeSnapshot = {
      userId: p.userId,
      email: u?.email ?? '(unknown)',
      name: [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.email || 'Candidate',
      participationId: p.id,
      status: p.status,
      setId: p.setId,
      startedAt: new Date(p.startedAt).toISOString(),
      riskScore: p.riskScore || 0,
      tabSwitchCount: p.tabSwitchCount || 0,
      fullscreenExitCount: p.fullscreenExitCount || 0,
      copyPasteCount: p.copyPasteCount || 0,
      totalScore: Number(p.totalScore || 0),
      currentPaperId: currentPaper?.id ?? null,
      currentPaperName: currentPaper?.name ?? null,
      currentQuestionIndex: cq?.idx ?? null,
      totalQuestionsInPaper: cq?.total ?? currentPaper?.totalQuestions ?? null,
      paperStartedAt: inProgress?.startedAt ? new Date(inProgress.startedAt).toISOString() : null,
      lastEventAt: new Date().toISOString(),
    };
    this.emitToTest(testId, 'attendee.update', { attendee });
  }

  trackQuestion(testId: string, userId: string, idx: number, total: number) {
    this.currentQuestionMap.set(`${testId}:${userId}`, { idx, total });
    this.emitToTest(testId, 'attendee.question', { userId, currentQuestionIndex: idx, totalQuestionsInPaper: total });
  }

  emitViolation(testId: string, userId: string, type: string, riskScore: number) {
    this.emitToTest(testId, 'attendee.violation', { userId, type, riskScore, at: new Date().toISOString() });
  }

  emitJoined(testId: string, userId: string) {
    this.pushAttendeeUpdate(testId, userId).catch(() => undefined);
  }

  emitLeft(testId: string, userId: string) {
    this.emitToTest(testId, 'attendee.left', { userId });
  }
}

function roomFor(testId: string) {
  return `monitor:${testId}`;
}

// Lightweight In(...) avoiding extra import noise — TypeORM accepts `In([])`.
function anyOf<T>(arr: T[]) {
  // Will be replaced by TypeORM's In helper at call site if needed; using IN clause inline.
  return require('typeorm').In(arr);
}
