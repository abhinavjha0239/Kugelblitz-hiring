import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { TestParticipation, ParticipationStatus } from '../results/test-participation.entity';
import { Test } from '../tests/test.entity';
import { Question, QuestionType } from '../questions/question.entity';
import { McqResponse } from './mcq-response.entity';
import { ViolationLog, ViolationType } from './violation-log.entity';
import { ActionLog, ActionEventType } from './action-log.entity';
import { Submission, SubmissionStatus } from '../submissions/submission.entity';
import { SubmissionProducer } from '../queue/submission.producer';
import { PaperService } from '../paper/paper.service';
import { RandomizationService } from '../paper/randomization.service';
import { PaperSessionCacheService } from '../paper/paper-session-cache.service';
import { Paper } from '../paper/paper.entity';
import { PaperQuestion } from '../paper/paper-question.entity';
import {
  StudentPaperSession,
  StudentPaperSessionStatus,
} from '../paper/student-paper-session.entity';
import { MagicLinkService } from '../magic-link/magic-link.service';
import { MonitoringGateway } from '../monitoring/monitoring.gateway';
import { ExamSetService } from '../exam-set/exam-set.service';

@Injectable()
export class TestSessionService {
  private readonly logger = new Logger(TestSessionService.name);
  private redis: Redis;

  constructor(
    @InjectRepository(TestParticipation)
    private participationsRepo: Repository<TestParticipation>,
    @InjectRepository(Test)
    private testsRepo: Repository<Test>,
    @InjectRepository(Question)
    private questionsRepo: Repository<Question>,
    @InjectRepository(McqResponse)
    private mcqResponsesRepo: Repository<McqResponse>,
    @InjectRepository(ViolationLog)
    private violationLogsRepo: Repository<ViolationLog>,
    @InjectRepository(ActionLog)
    private actionLogsRepo: Repository<ActionLog>,
    @InjectRepository(Submission)
    private submissionsRepo: Repository<Submission>,
    @InjectRepository(Paper)
    private papersRepo: Repository<Paper>,
    @InjectRepository(StudentPaperSession)
    private studentPaperSessionsRepo: Repository<StudentPaperSession>,
    @InjectRepository(PaperQuestion)
    private paperQuestionsRepo: Repository<PaperQuestion>,
    private submissionProducer: SubmissionProducer,
    private configService: ConfigService,
    private paperService: PaperService,
    private randomizationService: RandomizationService,
    private paperSessionCacheService: PaperSessionCacheService,
    private magicLinkService: MagicLinkService,
    private monitoring: MonitoringGateway,
    private examSetService: ExamSetService,
  ) {
    this.redis = new Redis({
      host: this.configService.get('redis.host'),
      port: this.configService.get('redis.port'),
      password: this.configService.get('redis.password') || undefined,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    this.redis.connect().catch((err) => {
      this.logger.error('Redis connection failed', err.message);
    });
  }

  // ─── DISTRIBUTED LOCK ──────────────────────────────────────
  // Single-flight guarantee for cross-table writes that share unique
  // indexes — concurrent calls (StrictMode double-mount, double-click,
  // duplicate magic-link click, retried HTTP) serialize cleanly instead
  // of fighting over InnoDB gap locks on (user_id, test_id, attempt_number)
  // and (session_id, paper_id) and producing deadlocks.
  //
  // Lua-CAS release prevents accidentally freeing a lock our token doesn't
  // own (e.g. if we exceeded the TTL and someone else acquired it after).
  private async withLock<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const maxWaitMs = 10_000;
    const start = Date.now();
    // Acquire — poll with backoff if contended. Keep poll short so legitimate
    // serial calls don't pile up; bail with a 409-style error if we never get it.
    while (true) {
      const ok = await this.redis.set(key, token, 'EX', ttlSeconds, 'NX');
      if (ok === 'OK') break;
      if (Date.now() - start > maxWaitMs) {
        throw new BadRequestException('Another start request is in progress. Please retry.');
      }
      await new Promise((r) => setTimeout(r, 75 + Math.random() * 150));
    }
    try {
      return await fn();
    } finally {
      const release = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`;
      await this.redis.eval(release, 1, key, token).catch((err) => {
        this.logger.warn(`Lock release failed for ${key}: ${err.message}`);
      });
    }
  }

  // ─── START TEST ────────────────────────────────────────────
  async startTest(userId: string, testId: string) {
    return this.withLock(`lock:exam:start:${userId}:${testId}`, 30, () => this.startTestImpl(userId, testId));
  }

  private async startTestImpl(userId: string, testId: string) {
    const test = await this.testsRepo.findOne({ where: { id: testId } });
    if (!test) throw new NotFoundException('Test not found');
    if (!test.isActive) throw new BadRequestException('Test is not active');

    const now = new Date();
    if (test.startsAt && now < new Date(test.startsAt)) {
      throw new BadRequestException({
        message: `Exam has not started yet. Starts at ${new Date(test.startsAt).toISOString()}.`,
        errors: {
          code: 'NOT_STARTED',
          startsAt: test.startsAt,
          endsAt: test.endsAt,
          serverTime: now.toISOString(),
        },
      });
    }
    if (test.endsAt && now > new Date(test.endsAt)) {
      throw new BadRequestException({
        message: `Exam window has closed. Ended at ${new Date(test.endsAt).toISOString()}.`,
        errors: {
          code: 'WINDOW_CLOSED',
          startsAt: test.startsAt,
          endsAt: test.endsAt,
          serverTime: now.toISOString(),
        },
      });
    }

    // Find latest non-reset participation
    const allParticipations = await this.participationsRepo.find({
      where: { userId, testId },
      order: { attemptNumber: 'DESC' },
    });

    const active = allParticipations.find((p) => p.status === ParticipationStatus.IN_PROGRESS);
    if (active) {
      const timer = await this.getTimerState(userId, testId);
      return { participation: active, timer };
    }

    const nonReset = allParticipations.find((p) => p.status !== ParticipationStatus.RESET);
    if (nonReset && nonReset.status !== ParticipationStatus.RESET) {
      throw new BadRequestException('You have already completed this test');
    }

    const attemptNumber = allParticipations.length > 0
      ? Math.max(...allParticipations.map((p) => p.attemptNumber)) + 1
      : 1;

    // Resolve setId for this participation: prefer the user's magic-link setId,
    // else the test's default set. We never let setId stay null after startTest
    // — otherwise paper.totalMarks fallback in cutoff math can use the wrong
    // denominator for non-default-set candidates.
    let resolvedSetId: string | null = null;
    try {
      const link = await this.magicLinkService.getActiveLinkForUserTest(userId, testId);
      resolvedSetId = link?.setId ?? null;
    } catch (err: any) {
      // Don't silently swallow — log loudly. Fall through to default-set resolution.
      this.logger.error(`Failed to read magic-link setId for ${userId}/${testId}: ${err.message}`);
    }
    if (!resolvedSetId) {
      try {
        const defaultSet = await this.examSetService.ensureDefaultSet(testId);
        resolvedSetId = defaultSet.id;
      } catch (err: any) {
        this.logger.error(`Failed to ensure default set for ${testId}: ${err.message}`);
        // Continue with null — service-level cutoff math will fall back to paper.totalMarks.
      }
    }

    let participation: any;
    const isDupOrLockError = (err: any) => {
      const code = err?.code || '';
      const msg = String(err?.message || '');
      return (
        code === 'ER_DUP_ENTRY' ||
        code === '23505' ||
        code === 'ER_LOCK_DEADLOCK' ||
        code === 'ER_LOCK_WAIT_TIMEOUT' ||
        msg.includes('Duplicate entry') ||
        msg.includes('Deadlock') ||
        msg.includes('Lock wait timeout')
      );
    };
    let retries = 3;
    while (retries-- > 0) {
      try {
        participation = this.participationsRepo.create({
          userId,
          testId,
          startedAt: now,
          status: ParticipationStatus.IN_PROGRESS,
          currentSection: test.hasSections ? 'mcq' : 'coding',
          mcqSubmitted: !test.hasSections,
          codingUnlocked: !test.hasSections,
          attemptNumber,
          setId: resolvedSetId,
        });
        participation = await this.participationsRepo.save(participation);
        break;
      } catch (err: any) {
        if (!isDupOrLockError(err)) throw err;
        // Either a parallel insert won, or we hit a deadlock — re-check IN_PROGRESS.
        const retry = await this.participationsRepo.findOne({
          where: { userId, testId, status: ParticipationStatus.IN_PROGRESS },
        });
        if (retry) {
          const timer = await this.getTimerState(userId, testId);
          return { participation: retry, timer };
        }
        // Deadlock without a winner row — wait a tick and retry.
        if (retries === 0) {
          throw new BadRequestException('Failed to start test. Please try again.');
        }
        await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
      }
    }

    const timerKey = `timer:${userId}:${testId}`;
    const totalSeconds = test.durationMinutes * 60;
    const mcqSeconds = test.mcqTimeMinutes ? test.mcqTimeMinutes * 60 : totalSeconds;
    const codingSeconds = test.codingTimeMinutes ? test.codingTimeMinutes * 60 : totalSeconds;

    await this.redis.hmset(timerKey, {
      startedAt: now.toISOString(),
      totalSeconds: totalSeconds.toString(),
      mcqSeconds: mcqSeconds.toString(),
      codingSeconds: codingSeconds.toString(),
      section: test.hasSections ? 'mcq' : 'coding',
    });
    // 24h TTL handles long exam windows + reconnects/admin extensions.
    await this.redis.expire(timerKey, 86400);

    const timer = await this.getTimerState(userId, testId);
    this.monitoring.emitJoined(testId, userId);
    return { participation, timer };
  }

  // ─── GET SESSION STATUS ────────────────────────────────────
  async getSessionStatus(userId: string, testId: string) {
    const participation = await this.participationsRepo.findOne({
      where: { userId, testId },
    });
    if (!participation) throw new NotFoundException('No active session');

    const test = await this.testsRepo.findOne({ where: { id: testId } });
    if (!test) throw new NotFoundException('Test not found');

    const timer = await this.getTimerState(userId, testId);

    if (timer.remaining <= 0 && participation.status === ParticipationStatus.IN_PROGRESS) {
      // Trigger auto-submit but return a discriminator the FE can branch on,
      // not the autoSubmit response shape (which doesn't include test/questions/timer).
      try {
        await this.autoSubmit(userId, testId);
      } catch (err: any) {
        this.logger.warn(`Auto-submit failed during status check: ${err.message}`);
      }
      return { autoSubmittedRedirect: '/student' as const, testId };
    }

    const mcqQuestions = await this.questionsRepo.find({
      where: { testId, type: QuestionType.MCQ, section: 1 },
      order: { orderIndex: 'ASC' },
      select: ['id', 'title', 'type', 'marks', 'orderIndex', 'section', 'mcqOptions', 'description'],
    });

    const codingQuestions = await this.questionsRepo.find({
      where: { testId, type: QuestionType.CODING, section: 2 },
      relations: ['testCases'],
      order: { orderIndex: 'ASC' },
    });

    const safeCodingQuestions = codingQuestions.map((q) => ({
      ...q,
      testCases: q.testCases.filter((tc) => !tc.isHidden),
    }));

    const mcqResponses = await this.mcqResponsesRepo.find({
      where: { participationId: participation.id },
    });
    const savedAnswers: Record<string, string> = {};
    mcqResponses.forEach((r) => {
      savedAnswers[r.questionId] = r.selectedOption;
    });

    return {
      participation,
      test: {
        id: test.id,
        title: test.title,
        description: test.description,
        durationMinutes: test.durationMinutes,
        hasSections: test.hasSections,
        mcqCutoffPercent: test.mcqCutoffPercent,
        totalMarks: test.totalMarks,
        allowedLanguages: test.allowedLanguages,
      },
      mcqQuestions,
      codingQuestions: participation.codingUnlocked ? safeCodingQuestions : [],
      savedAnswers,
      timer,
    };
  }

  // ─── SAVE MCQ ANSWER (one at a time) ──────────────────────
  async saveMcqAnswer(userId: string, testId: string, questionId: string, selectedOption: string) {
    const participation = await this.getActiveParticipation(userId, testId);
    if (participation.mcqSubmitted) {
      throw new BadRequestException('MCQ section already submitted');
    }

    const question = await this.questionsRepo.findOne({ where: { id: questionId, testId } });
    if (!question || question.type !== QuestionType.MCQ) {
      throw new BadRequestException('Invalid MCQ question');
    }

    // Validate selectedOption against the question's actual options
    if (!question.mcqOptions || question.mcqOptions.length === 0) {
      throw new BadRequestException('This question has no options configured');
    }
    const validOptionIds = question.mcqOptions.map((o) => o.id);
    if (!validOptionIds.includes(selectedOption)) {
      throw new BadRequestException(
        `Invalid option "${selectedOption}". Valid options: ${validOptionIds.join(', ')}`,
      );
    }

    let response = await this.mcqResponsesRepo.findOne({
      where: { participationId: participation.id, questionId },
    });

    if (response) {
      response.selectedOption = selectedOption;
      await this.mcqResponsesRepo.save(response);
    } else {
      response = this.mcqResponsesRepo.create({
        participationId: participation.id,
        userId,
        questionId,
        selectedOption,
      });
      await this.mcqResponsesRepo.save(response);
    }

    return { questionId, selectedOption, saved: true };
  }

  // ─── SUBMIT MCQ SECTION ────────────────────────────────────
  async submitMcqSection(userId: string, testId: string) {
    const participation = await this.getActiveParticipation(userId, testId);
    if (participation.mcqSubmitted) {
      throw new BadRequestException('MCQ section already submitted');
    }

    const test = await this.testsRepo.findOne({ where: { id: testId } });
    if (!test) throw new NotFoundException('Test not found');

    const mcqQuestions = await this.questionsRepo.find({
      where: { testId, type: QuestionType.MCQ, section: 1 },
    });

    const responses = await this.mcqResponsesRepo.find({
      where: { participationId: participation.id },
    });

    let mcqScore = 0;
    let totalMcqMarks = 0;
    let correct = 0;
    let wrong = 0;
    let unanswered = 0;
    const updatedResponses: McqResponse[] = [];

    for (const q of mcqQuestions) {
      totalMcqMarks += Number(q.marks);
      const resp = responses.find((r) => r.questionId === q.id);
      if (!resp) {
        unanswered++;
        continue;
      }

      const isCorrect = resp.selectedOption === q.mcqCorrectAnswer;
      const negPenalty = Number(q.negativeMarks) || Number(test.negativeMarkValue) || 0;
      const marksAwarded = isCorrect ? Number(q.marks) : -negPenalty;

      mcqScore += marksAwarded;
      resp.isCorrect = isCorrect;
      resp.marksAwarded = marksAwarded;
      updatedResponses.push(resp);

      if (isCorrect) correct++;
      else wrong++;
    }
    // One bulk save instead of N round-trips.
    if (updatedResponses.length > 0) {
      await this.mcqResponsesRepo.save(updatedResponses);
    }

    mcqScore = Math.max(0, mcqScore);

    const mcqPercent = totalMcqMarks > 0 ? (mcqScore / totalMcqMarks) * 100 : 0;
    const cutoffMet = mcqPercent >= Number(test.mcqCutoffPercent);

    participation.mcqScore = mcqScore;
    participation.mcqSubmitted = true;
    participation.codingUnlocked = cutoffMet;
    participation.currentSection = cutoffMet ? 'coding' : 'mcq';
    await this.participationsRepo.save(participation);

    if (cutoffMet) {
      const timerKey = `timer:${userId}:${testId}`;
      await this.redis.hset(timerKey, 'section', 'coding');
      await this.redis.hset(timerKey, 'codingStartedAt', new Date().toISOString());
    }

    this.logger.log(
      `MCQ submitted for user ${userId}: ${correct}/${mcqQuestions.length} correct, score=${mcqScore}/${totalMcqMarks}, cutoff=${cutoffMet}`,
    );

    return {
      mcqScore,
      totalMcqMarks,
      correct,
      wrong,
      unanswered,
      mcqPercent: Math.round(mcqPercent * 100) / 100,
      cutoffPercent: test.mcqCutoffPercent,
      cutoffMet,
      codingUnlocked: cutoffMet,
      message: cutoffMet
        ? 'Congratulations! You cleared the MCQ cutoff. Coding section is now unlocked.'
        : `You scored ${mcqPercent.toFixed(1)}% which is below the ${test.mcqCutoffPercent}% cutoff. Coding section remains locked.`,
    };
  }

  // ─── SUBMIT CODING SOLUTION ────────────────────────────────
  async submitCoding(userId: string, testId: string, questionId: string, languageId: number, sourceCode: string) {
    const participation = await this.getActiveParticipation(userId, testId);
    // Multi-paper flow: skip legacy codingUnlocked check when the question belongs
    // to a paper that is currently in_progress. Paper-level gating already
    // enforces unlock order via the cutoff/lock_next logic.
    let codingAllowed = participation.codingUnlocked;
    if (!codingAllowed) {
      const sessions = await this.paperService.getStudentPaperSessions(participation.id);
      const inProgressPaperIds = sessions
        .filter((s) => s.status === StudentPaperSessionStatus.IN_PROGRESS)
        .map((s) => s.paperId);
      if (inProgressPaperIds.length > 0) {
        const link = await this.paperQuestionsRepo.findOne({
          where: { questionId, paperId: In(inProgressPaperIds) },
        });
        if (link) codingAllowed = true;
      }
    }
    if (!codingAllowed) {
      throw new ForbiddenException('Coding section is locked. Complete MCQ first.');
    }

    const rateLimitKey = `ratelimit:${userId}:${testId}`;
    const lastSubmit = await this.redis.get(rateLimitKey);
    if (lastSubmit && Date.now() - parseInt(lastSubmit) < 3000) {
      throw new BadRequestException('Please wait 3 seconds between submissions');
    }
    await this.redis.set(rateLimitKey, Date.now().toString(), 'EX', 5);

    const submission = this.submissionsRepo.create({
      userId,
      questionId,
      testId,
      languageId,
      sourceCode,
      status: SubmissionStatus.QUEUED,
      isFinal: true,
    });
    const saved = await this.submissionsRepo.save(submission);

    await this.submissionProducer.addSubmissionJob({
      submissionId: saved.id,
      userId,
      questionId,
      testId,
      sourceCode,
      languageId,
      isFinal: true,
    });

    return saved;
  }

  // ─── FINAL SUBMIT ─────────────────────────────────────────
  async finalSubmit(userId: string, testId: string, isAutoSubmit = false) {
    // Tab-switch auto-submit + timer-tick auto-submit + a manual click can
    // all fire within the same second. Both pass the IN_PROGRESS check
    // before either commits, then both write — score gets recomputed twice
    // and we log "final submit" twice. The Redis lock serializes them.
    return this.withLock(`lock:exam:submit:${userId}:${testId}`, 30, () =>
      this.finalSubmitImpl(userId, testId, isAutoSubmit),
    );
  }

  private async finalSubmitImpl(userId: string, testId: string, isAutoSubmit = false) {
    const participation = await this.participationsRepo.findOne({
      where: { userId, testId },
    });
    if (!participation) throw new NotFoundException('No active session');
    if (participation.status !== ParticipationStatus.IN_PROGRESS) {
      return { participation, message: 'Test already submitted' };
    }

    // Skip the legacy section-based MCQ submission if this exam uses the paper-based flow.
    const paperCount = await this.papersRepo.count({ where: { examId: testId } });
    const usesPapers = paperCount > 0;
    if (!usesPapers && !participation.mcqSubmitted) {
      try {
        await this.submitMcqSection(userId, testId);
      } catch (err) {
        this.logger.warn(`Auto MCQ submit failed for user ${userId}: ${err.message}`);
      }
    }

    // Re-fetch participation to get updated mcqScore from submitMcqSection
    const updated = await this.participationsRepo.findOne({ where: { userId, testId } });
    const current = updated || participation;

    const codingScore = await this.calculateCodingScore(userId, testId);

    if (usesPapers) {
      // Paper flow accumulates totalScore inside submitPaper. Recompute from the
      // ground truth (sum of submitted paper sessions) to be idempotent and to
      // avoid the legacy mcq+coding overwrite that would zero a paper-flow run.
      const sessions = await this.studentPaperSessionsRepo.find({
        where: { sessionId: current.id },
      });
      current.totalScore = sessions
        .filter((s) => s.status === StudentPaperSessionStatus.SUBMITTED)
        .reduce((sum, s) => sum + Number(s.score || 0), 0);
    } else {
      current.codingScore = codingScore;
      current.totalScore = Number(current.mcqScore) + codingScore;
    }
    current.submittedAt = new Date();
    current.status = isAutoSubmit ? ParticipationStatus.TIMED_OUT : ParticipationStatus.SUBMITTED;
    current.autoSubmitted = isAutoSubmit;
    await this.participationsRepo.save(current);

    await this.redis.del(`timer:${userId}:${testId}`);

    try {
      await this.magicLinkService.markSubmittedByUserAndTest(userId, testId);
    } catch (err: any) {
      this.logger.warn(`Failed to mark magic-link submitted: ${err.message}`);
    }
    this.monitoring.emitLeft(testId, userId);

    this.logger.log(
      `Test final submit: user=${userId}, mcq=${current.mcqScore}, coding=${codingScore}, total=${current.totalScore}, auto=${isAutoSubmit}`,
    );

    return {
      participation: current,
      mcqScore: current.mcqScore,
      codingScore,
      totalScore: current.totalScore,
    };
  }

  // ─── AUTO SUBMIT (timeout) ─────────────────────────────────
  async autoSubmit(userId: string, testId: string) {
    this.logger.warn(`Auto-submitting test for user ${userId} on test ${testId}`);
    return this.finalSubmit(userId, testId, true);
  }

  // ─── TIMER SYNC ────────────────────────────────────────────
  async getTimerState(userId: string, testId: string) {
    const timerKey = `timer:${userId}:${testId}`;
    const data = await this.redis.hgetall(timerKey);
    // Sliding TTL: every read pushes the expiry out so a long exam never
    // outlives the cached timer. No-op if the key doesn't exist.
    if (data && data.startedAt) {
      await this.redis.expire(timerKey, 86400).catch(() => undefined);
    }

    if (!data || !data.startedAt) {
      const participation = await this.participationsRepo.findOne({ where: { userId, testId } });
      const test = await this.testsRepo.findOne({ where: { id: testId } });
      if (!participation || !test) {
        return { remaining: 0, totalSeconds: 0, section: 'mcq', serverTime: new Date().toISOString() };
      }
      const elapsed = (Date.now() - new Date(participation.startedAt).getTime()) / 1000;
      const remaining = Math.max(0, test.durationMinutes * 60 - elapsed);
      return {
        remaining: Math.floor(remaining),
        totalSeconds: test.durationMinutes * 60,
        section: participation.currentSection,
        serverTime: new Date().toISOString(),
      };
    }

    const section = data.section || 'mcq';
    const startedAt = new Date(data.startedAt).getTime();
    const totalSeconds = parseInt(data.totalSeconds);

    // Use section-specific timer when available
    let sectionSeconds = totalSeconds;
    if (section === 'mcq' && data.mcqSeconds) {
      sectionSeconds = Math.min(parseInt(data.mcqSeconds), totalSeconds);
    } else if (section === 'coding' && data.codingSeconds && data.codingStartedAt) {
      const codingStart = new Date(data.codingStartedAt).getTime();
      const codingElapsed = (Date.now() - codingStart) / 1000;
      const codingRemaining = Math.max(0, parseInt(data.codingSeconds) - codingElapsed);

      const globalElapsed = (Date.now() - startedAt) / 1000;
      const globalRemaining = Math.max(0, totalSeconds - globalElapsed);

      return {
        remaining: Math.floor(Math.min(codingRemaining, globalRemaining)),
        totalSeconds,
        section,
        serverTime: new Date().toISOString(),
      };
    }

    const elapsed = (Date.now() - startedAt) / 1000;
    const remaining = Math.max(0, Math.min(sectionSeconds, totalSeconds) - elapsed);

    return {
      remaining: Math.floor(remaining),
      totalSeconds,
      section,
      serverTime: new Date().toISOString(),
    };
  }

  // ─── RISK SCORE WEIGHTS ────────────────────────────────────
  private static readonly RISK_WEIGHTS: Record<string, number> = {
    tab_switch: 5,
    copy_paste: 10,
    fullscreen_exit: 10,
    rapid_answer: 8,
    multiple_ip: 15,
  };

  // ─── ANTI-CHEAT LOGGING ────────────────────────────────────
  async logAntiCheat(userId: string, testId: string, type: string, ipAddress?: string) {
    const participation = await this.participationsRepo.findOne({
      where: { userId, testId },
    });
    if (!participation) return;

    if (type === 'tab_switch') {
      participation.tabSwitchCount += 1;
    } else if (type === 'fullscreen_exit') {
      participation.fullscreenExitCount += 1;
    } else if (type === 'copy_paste') {
      participation.copyPasteCount += 1;
    }

    const weight = TestSessionService.RISK_WEIGHTS[type] || 0;
    participation.riskScore += weight;
    participation.violationCount += 1;

    await this.participationsRepo.save(participation);

    const violationTypeMap: Record<string, ViolationType> = {
      tab_switch: ViolationType.TAB_SWITCH,
      fullscreen_exit: ViolationType.FULLSCREEN_EXIT,
      copy_paste: ViolationType.COPY_PASTE,
    };
    if (violationTypeMap[type]) {
      const log = this.violationLogsRepo.create({
        participationId: participation.id,
        userId,
        testId,
        type: violationTypeMap[type],
        ipAddress: ipAddress || null,
        metadata: { timestamp: new Date().toISOString(), riskAdded: weight },
      });
      await this.violationLogsRepo.save(log);
    }

    const logKey = `anticheat:${userId}:${testId}`;
    await this.redis.rpush(logKey, JSON.stringify({ type, timestamp: new Date().toISOString() }));
    await this.redis.expire(logKey, 86400);

    // Real-time push to admin monitor
    this.monitoring.emitViolation(testId, userId, type, participation.riskScore || 0);
    this.monitoring.pushAttendeeUpdate(testId, userId).catch(() => undefined);

    return { riskScore: participation.riskScore, violationCount: participation.violationCount };
  }

  // ─── TRACK TIME PER QUESTION ──────────────────────────────
  async trackQuestionTime(userId: string, testId: string, questionId: string, timeSpentSeconds: number) {
    const participation = await this.getActiveParticipation(userId, testId);
    const timeMap = participation.timePerQuestion || {};
    timeMap[questionId] = (timeMap[questionId] || 0) + timeSpentSeconds;
    participation.timePerQuestion = timeMap;
    await this.participationsRepo.save(participation);

    if (timeSpentSeconds < 3) {
      const weight = TestSessionService.RISK_WEIGHTS['rapid_answer'] || 0;
      participation.riskScore += weight;
      participation.violationCount += 1;
      await this.participationsRepo.save(participation);

      const log = this.violationLogsRepo.create({
        participationId: participation.id,
        userId,
        testId,
        type: ViolationType.RAPID_ANSWER,
        metadata: { questionId, timeSpentSeconds, riskAdded: weight },
      });
      await this.violationLogsRepo.save(log);
    }

    return { questionId, totalTime: timeMap[questionId] };
  }

  // ─── STORE IP ON SESSION START ────────────────────────────
  async recordIpAddress(userId: string, testId: string, ipAddress: string) {
    const participation = await this.participationsRepo.findOne({ where: { userId, testId } });
    if (!participation) return;

    participation.ipAddress = ipAddress;
    await this.participationsRepo.save(participation);

    // Check for same IP used by multiple users on same test
    const sameIpCount = await this.participationsRepo.count({
      where: { testId, ipAddress },
    });
    if (sameIpCount > 1) {
      const log = this.violationLogsRepo.create({
        participationId: participation.id,
        userId,
        testId,
        type: ViolationType.MULTIPLE_IP,
        ipAddress,
        metadata: { sameIpCount },
      });
      await this.violationLogsRepo.save(log);
      this.logger.warn(`Multiple users (${sameIpCount}) on same IP ${ipAddress} for test ${testId}`);
    }
  }

  // ─── ADMIN: ACTIVE USERS ─────────────────────────────────
  async getActiveUsers(testId: string) {
    const participations = await this.participationsRepo.find({
      where: { testId, status: ParticipationStatus.IN_PROGRESS },
      relations: ['user'],
      order: { startedAt: 'ASC' },
    });

    return {
      count: participations.length,
      users: participations.map((p) => ({
        participationId: p.id,
        userId: p.userId,
        name: `${p.user.firstName} ${p.user.lastName}`,
        email: p.user.email,
        currentSection: p.currentSection,
        mcqSubmitted: p.mcqSubmitted,
        codingUnlocked: p.codingUnlocked,
        tabSwitchCount: p.tabSwitchCount,
        fullscreenExitCount: p.fullscreenExitCount,
        copyPasteCount: p.copyPasteCount,
        riskScore: p.riskScore,
        violationCount: p.violationCount,
        ipAddress: p.ipAddress,
        startedAt: p.startedAt,
      })),
    };
  }

  // ─── ADMIN: ALL RESULTS WITH PROCTORING DATA ──────────────
  async getResultsWithProctoring(testId: string) {
    const participations = await this.participationsRepo.find({
      where: { testId },
      relations: ['user'],
      order: { totalScore: 'DESC', submittedAt: 'ASC' },
    });

    return participations.map((p, i) => ({
      rank: i + 1,
      userId: p.userId,
      name: `${p.user.firstName} ${p.user.lastName}`,
      email: p.user.email,
      status: p.status,
      mcqScore: p.mcqScore,
      codingScore: p.codingScore,
      totalScore: p.totalScore,
      riskScore: p.riskScore,
      riskLevel: p.riskScore >= 30 ? 'high' : p.riskScore >= 15 ? 'medium' : 'low',
      violationCount: p.violationCount,
      tabSwitchCount: p.tabSwitchCount,
      fullscreenExitCount: p.fullscreenExitCount,
      copyPasteCount: p.copyPasteCount,
      ipAddress: p.ipAddress,
      autoSubmitted: p.autoSubmitted,
      startedAt: p.startedAt,
      submittedAt: p.submittedAt,
    }));
  }

  // ─── ADMIN: VIOLATIONS ────────────────────────────────────
  async getViolations(testId: string) {
    const logs = await this.violationLogsRepo.find({
      where: { testId },
      relations: ['user'],
      order: { createdAt: 'DESC' },
      take: 500,
    });

    return {
      count: logs.length,
      violations: logs.map((l) => ({
        id: l.id,
        userId: l.userId,
        userName: l.user ? `${l.user.firstName} ${l.user.lastName}` : 'Unknown',
        type: l.type,
        ipAddress: l.ipAddress,
        metadata: l.metadata,
        createdAt: l.createdAt,
      })),
    };
  }

  // ─── MULTI-PAPER: START EXAM ───────────────────────────────
  async startExamSession(userId: string, testId: string) {
    // Same lock key as startTest — participation create + paper-session inserts
    // happen atomically from the perspective of any other caller for this
    // (user, test). Prevents StrictMode/double-click duplicates from racing.
    return this.withLock(`lock:exam:start:${userId}:${testId}`, 30, async () => {
      await this.startTestImpl(userId, testId);
      const participation = await this.getActiveParticipation(userId, testId);
      const papers = await this.paperService.listExamPapers(testId);

      if (papers.length === 0) {
        return {
          mode: 'legacy',
          participation,
          message: 'No papers configured for this exam. Legacy flow is active.',
        };
      }

      const sessions = await this.paperService.ensurePaperSessionsForSession(participation.id, papers);
      return {
        mode: 'multi-paper',
        participation,
        papers: sessions.map((s) => ({
          paperId: s.paperId,
          paperSessionId: s.id,
          name: s.paper?.name,
          order: s.paper?.order,
          status: s.status,
          durationMinutes: s.paper?.durationMinutes,
        })),
        currentPaperId: sessions.find((s) => s.status === StudentPaperSessionStatus.IN_PROGRESS)?.paperId
          || sessions.find((s) => s.status === StudentPaperSessionStatus.NOT_STARTED)?.paperId
          || null,
      };
    });
  }

  // ─── MULTI-PAPER: START PAPER ──────────────────────────────
  async startPaper(userId: string, paperId: string) {
    const paper = await this.paperService.getPaperById(paperId);
    return this.withLock(`lock:exam:start:${userId}:${paper.examId}`, 30, () =>
      this.startPaperImpl(userId, paperId, paper),
    );
  }

  private async startPaperImpl(userId: string, paperId: string, paper: Paper) {
    const participation = await this.getActiveParticipation(userId, paper.examId);
    const papers = await this.paperService.listExamPapers(paper.examId);
    await this.paperService.ensurePaperSessionsForSession(participation.id, papers);

    const sessions = await this.paperService.getStudentPaperSessions(participation.id);
    const targetSession = sessions.find((s) => s.paperId === paperId);
    if (!targetSession) throw new NotFoundException('Paper session not found');

    const previousPapers = sessions
      .filter((s) => (s.paper?.order || 0) < (paper.order || 0))
      .sort((a, b) => (a.paper?.order || 0) - (b.paper?.order || 0));
    const blocked = previousPapers.find((s) => s.status !== StudentPaperSessionStatus.SUBMITTED);
    if (blocked) {
      throw new ForbiddenException('Previous paper must be submitted before starting this paper');
    }

    if (targetSession.status === StudentPaperSessionStatus.LOCKED_FAIL) {
      throw new ForbiddenException('You did not meet the cutoff for the previous paper. This paper is locked.');
    }
    const lastPrev = previousPapers[previousPapers.length - 1];
    if (lastPrev && lastPrev.cutoffPassed === false) {
      const prevPaper = lastPrev.paper;
      if (prevPaper?.cutoffFailBehavior === 'lock_next') {
        targetSession.status = StudentPaperSessionStatus.LOCKED_FAIL;
        await this.studentPaperSessionsRepo.save(targetSession);
        throw new ForbiddenException('You did not meet the cutoff for the previous paper. This paper is locked.');
      }
      if (prevPaper?.cutoffFailBehavior === 'end_exam') {
        throw new ForbiddenException('Exam ended after the previous paper cutoff was not met.');
      }
    }

    if (targetSession.status === StudentPaperSessionStatus.SUBMITTED) {
      throw new BadRequestException('Paper already submitted');
    }

    if (targetSession.status === StudentPaperSessionStatus.NOT_STARTED) {
      const test = await this.testsRepo.findOne({ where: { id: paper.examId } });
      const baseDuration = paper.durationMinutes;
      const effective = test
        ? this.paperService.computeCarryOverDuration(
            test.timerMode || 'per_paper',
            !!test.timeCarryOver,
            lastPrev || null,
            baseDuration,
          )
        : baseDuration;
      targetSession.status = StudentPaperSessionStatus.IN_PROGRESS;
      targetSession.startedAt = new Date();
      targetSession.unlockedAt = new Date();
      targetSession.effectiveDurationMinutes = Math.round(effective);
      await this.studentPaperSessionsRepo.save(targetSession);
    }

    let cached = await this.paperSessionCacheService.getPaperSession(userId, paperId);
    if (!cached) {
      const pool = await this.paperService.getPaperQuestions(paperId, participation.setId || undefined);
      const randomized = this.randomizationService.shuffleQuestionsByStudent(
        pool,
        userId,
        paperId,
        paper.totalQuestions,
      );
      const { rendered, answerKey, optionIdMap } = this.randomizationService.buildRenderedQuestions(randomized, userId);
      cached = {
        paperSessionId: targetSession.id,
        testId: paper.examId,
        paperId,
        userId,
        generatedAt: new Date().toISOString(),
        questions: rendered,
        answerKey,
        optionIdMap,
      };
      await this.paperSessionCacheService.setPaperSession(cached);
    }

    const autosavedAnswers = await this.paperSessionCacheService.getAutosavedAnswers(userId, paperId);

    // Compute remainingSeconds for the freshly-started/resumed paper. Frontend
    // initial timer state is 0, and without this value the client immediately
    // auto-submits when its 1Hz interval fires the first tick. Use the same
    // math as exam-status: remaining = effectiveDuration*60 − elapsed since
    // startedAt (or full duration if just started).
    const effectiveMin = targetSession.effectiveDurationMinutes || paper.durationMinutes;
    const startedAtMs = targetSession.startedAt ? new Date(targetSession.startedAt).getTime() : Date.now();
    const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
    const remainingSeconds = Math.max(0, effectiveMin * 60 - elapsedSec);

    return {
      paperSession: targetSession,
      paper: {
        id: paper.id,
        examId: paper.examId,
        name: paper.name,
        order: paper.order,
        durationMinutes: paper.durationMinutes,
        totalQuestions: paper.totalQuestions,
      },
      questions: cached.questions,
      answers: autosavedAnswers,
      remainingSeconds,
    };
  }

  async autosavePaperAnswers(userId: string, paperId: string, answers: Record<string, string>) {
    // Rate limit: max 60 autosaves per 60-second window per user-paper (5× normal cadence).
    // Prevents automated answer-probing scripts; normal candidates never hit this.
    const rlKey = `rl:autosave:${userId}:${paperId}`;
    const count = await this.redis.incr(rlKey);
    if (count === 1) await this.redis.expire(rlKey, 60);
    if (count > 60) {
      return { saved: false, count: 0, rateLimited: true };
    }

    const paper = await this.paperService.getPaperById(paperId);
    const participation = await this.getActiveParticipation(userId, paper.examId);
    const sessions = await this.paperService.getStudentPaperSessions(participation.id);
    const target = sessions.find((s) => s.paperId === paperId);
    if (!target || target.status !== StudentPaperSessionStatus.IN_PROGRESS) {
      throw new BadRequestException('Paper is not in progress');
    }

    // Drop any submitted option ID that is not in the session's scrambled-ID map.
    // This silently ignores tampered values rather than 400ing — the candidate
    // just won't have that answer saved (and will see a blank on resume).
    const cached = await this.paperSessionCacheService.getPaperSession(userId, paperId);
    const cleanedAnswers: Record<string, string> = {};
    for (const [qId, optId] of Object.entries(answers || {})) {
      if (!optId) continue;
      if (cached?.optionIdMap && !cached.optionIdMap[optId]) continue; // tampered scrambled ID
      cleanedAnswers[qId] = optId;
    }

    await this.paperSessionCacheService.setAutosavedAnswers(userId, paperId, cleanedAnswers);
    const total = cached?.questions?.length ?? 0;
    const answeredCount = Object.values(cleanedAnswers).filter(Boolean).length;
    this.monitoring.trackQuestion(paper.examId, userId, answeredCount, total);
    return { saved: true, count: Object.keys(cleanedAnswers).length };
  }

  async submitPaper(userId: string, paperId: string, incomingAnswers?: Record<string, string>) {
    const paper = await this.paperService.getPaperById(paperId);
    const participation = await this.getActiveParticipation(userId, paper.examId);
    const sessions = await this.paperService.getStudentPaperSessions(participation.id);
    const target = sessions.find((s) => s.paperId === paperId);
    if (!target) throw new NotFoundException('Paper session not found');
    if (target.status === StudentPaperSessionStatus.SUBMITTED) {
      return { paperSession: target, alreadySubmitted: true };
    }

    let cached = await this.paperSessionCacheService.getPaperSession(userId, paperId);
    if (!cached) {
      // Cache TTL expired (long exam window) — regenerate deterministically from
      // the same seed used in startPaper so the candidate gets the same question
      // set + answer key they were working with.
      this.logger.warn(`Paper-session cache miss for user=${userId} paper=${paperId}; regenerating`);
      const pool = await this.paperService.getPaperQuestions(paperId, participation.setId || undefined);
      const randomized = this.randomizationService.shuffleQuestionsByStudent(
        pool,
        userId,
        paperId,
        paper.totalQuestions,
      );
      const { rendered, answerKey, optionIdMap } = this.randomizationService.buildRenderedQuestions(randomized, userId);
      cached = {
        paperSessionId: target.id,
        testId: paper.examId,
        paperId,
        userId,
        generatedAt: new Date().toISOString(),
        questions: rendered,
        answerKey,
        optionIdMap,
      };
      await this.paperSessionCacheService.setPaperSession(cached);
    }
    const autosaved = await this.paperSessionCacheService.getAutosavedAnswers(userId, paperId);
    const answers = { ...autosaved, ...(incomingAnswers || {}) };
    await this.paperSessionCacheService.setAutosavedAnswers(userId, paperId, answers);

    let score = 0;
    let totalMarks = 0;
    const questionMap = new Map(cached.questions.map((q) => [q.id, q]));

    const records: McqResponse[] = [];
    for (const [questionId, expected] of Object.entries(cached.answerKey)) {
      const question = questionMap.get(questionId);
      if (!question) continue;
      totalMarks += Number(question.marks || 0);
      // Only build McqResponse rows for actual MCQ questions; coding questions
      // appear in cache but have no expected answer and no candidate-selectable option.
      if (question.type !== QuestionType.MCQ) continue;

      const submittedId = answers[questionId];
      // Translate per-student scrambled option ID → canonical option ID.
      // If optionIdMap is present (all sessions created after this deploy) and
      // the submitted ID is not in the map, treat as unanswered (tampered value).
      // Legacy sessions without optionIdMap fall back to literal comparison.
      const realSelected = submittedId
        ? cached.optionIdMap
          ? (cached.optionIdMap[submittedId] ?? null)
          : submittedId
        : null;

      const isCorrect = realSelected && expected ? realSelected === expected : false;
      const marksAwarded = isCorrect ? Number(question.marks || 0) : 0;
      score += marksAwarded;
      records.push(
        this.mcqResponsesRepo.create({
          participationId: participation.id,
          userId,
          questionId,
          selectedOption: realSelected || '',
          isCorrect,
          marksAwarded,
        }),
      );
    }
    if (records.length > 0) {
      await this.mcqResponsesRepo.save(records);
    }

    const setTotalMarks = participation.setId
      ? await this.paperService.getPaperTotalMarksForSet(paperId, participation.setId)
      : Number(paper.totalMarks);
    const cutoffPassed = this.paperService.evaluateCutoff(paper, score, setTotalMarks);
    target.score = score;
    target.cutoffPassed = cutoffPassed;
    target.status = StudentPaperSessionStatus.SUBMITTED;
    target.submittedAt = new Date();
    await this.studentPaperSessionsRepo.save(target);

    const orderedSessions = [...sessions].sort((a, b) => (a.paper?.order || 0) - (b.paper?.order || 0));
    const nextSession = orderedSessions.find((s) => (s.paper?.order || 0) === (paper.order + 1));

    let nextLocked = false;
    let endExam = false;
    if (!cutoffPassed) {
      if (paper.cutoffFailBehavior === 'lock_next' && nextSession) {
        nextSession.status = StudentPaperSessionStatus.LOCKED_FAIL;
        await this.studentPaperSessionsRepo.save(nextSession);
        nextLocked = true;
      } else if (paper.cutoffFailBehavior === 'end_exam') {
        endExam = true;
      }
    }

    // Idempotent recompute from authoritative source (paper sessions). Avoids
    // double-add when two parallel submitPaper calls race past the SUBMITTED check.
    const freshSessions = await this.studentPaperSessionsRepo.find({
      where: { sessionId: participation.id },
    });
    participation.totalScore = freshSessions
      .filter((s) => s.status === StudentPaperSessionStatus.SUBMITTED)
      .reduce((sum, s) => sum + Number(s.score || 0), 0);
    const remainingPlayable = orderedSessions.filter(
      (s) =>
        s.paperId !== target.paperId &&
        s.status !== StudentPaperSessionStatus.SUBMITTED &&
        s.status !== StudentPaperSessionStatus.LOCKED_FAIL,
    );
    const allDone = remainingPlayable.length === 0;

    if (endExam || allDone) {
      participation.status = ParticipationStatus.SUBMITTED;
      participation.submittedAt = new Date();
    }
    await this.participationsRepo.save(participation);

    if (endExam || allDone) {
      try {
        await this.magicLinkService.markSubmittedByUserAndTest(userId, paper.examId);
      } catch (err: any) {
        this.logger.warn(`Failed to mark magic-link submitted: ${err.message}`);
      }
      this.monitoring.emitLeft(paper.examId, userId);
    } else {
      this.monitoring.pushAttendeeUpdate(paper.examId, userId).catch(() => undefined);
    }

    return {
      paperSession: target,
      score,
      totalMarks,
      cutoffPassed,
      cutoffType: paper.cutoffType,
      cutoffValue: Number(paper.cutoffValue),
      nextPaperId: nextLocked ? null : nextSession?.paperId || null,
      nextPaperLocked: nextLocked,
      unlockedNextPaper: !!nextSession && !nextLocked,
      examEnded: endExam,
      examCompleted: endExam || allDone,
    };
  }

  async getExamStatus(userId: string, testId: string) {
    const participation = await this.participationsRepo.findOne({ where: { userId, testId } });
    if (!participation) throw new NotFoundException('No exam session found');

    const papers = await this.paperService.listExamPapers(testId);
    const paperSessions = await this.paperService.getStudentPaperSessions(participation.id);

    const test = await this.testsRepo.findOne({ where: { id: testId } });
    const mapByPaperId = new Map(paperSessions.map((s) => [s.paperId, s]));
    const sortedPapers = [...papers].sort((a, b) => a.order - b.order);

    const payload = sortedPapers.map((paper) => {
      const ps = mapByPaperId.get(paper.id);
      const prev = sortedPapers
        .filter((p) => p.order < paper.order)
        .map((p) => mapByPaperId.get(p.id))
        .filter(Boolean) as StudentPaperSession[];
      const lastPrev = prev[prev.length - 1];
      const previousSubmitted = prev.every((p) => p.status === StudentPaperSessionStatus.SUBMITTED);
      const lockedByCutoff =
        ps?.status === StudentPaperSessionStatus.LOCKED_FAIL ||
        (lastPrev?.cutoffPassed === false && lastPrev.paper?.cutoffFailBehavior === 'lock_next');

      const startedAt = ps?.startedAt ? new Date(ps.startedAt).getTime() : null;
      const effectiveMin = ps?.effectiveDurationMinutes || paper.durationMinutes;
      const elapsed = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
      const remaining = Math.max(0, effectiveMin * 60 - elapsed);

      return {
        paperId: paper.id,
        name: paper.name,
        order: paper.order,
        durationMinutes: paper.durationMinutes,
        effectiveDurationMinutes: effectiveMin,
        totalQuestions: paper.totalQuestions,
        passRequired: paper.passRequired,
        cutoffType: paper.cutoffType,
        cutoffValue: Number(paper.cutoffValue),
        cutoffFailBehavior: paper.cutoffFailBehavior,
        cutoffPassed: ps?.cutoffPassed ?? null,
        score: ps?.score != null ? Number(ps.score) : null,
        totalMarks: paper.totalMarks,
        status: ps?.status || StudentPaperSessionStatus.NOT_STARTED,
        locked: lockedByCutoff || (!previousSubmitted && paper.order > 1),
        lockedReason: lockedByCutoff
          ? 'cutoff_failed'
          : !previousSubmitted && paper.order > 1
            ? 'previous_in_progress'
            : null,
        startedAt: ps?.startedAt || null,
        submittedAt: ps?.submittedAt || null,
        remainingSeconds: ps?.status === StudentPaperSessionStatus.IN_PROGRESS ? remaining : null,
      };
    });

    return {
      participation,
      timerMode: test?.timerMode || 'per_paper',
      timeCarryOver: !!test?.timeCarryOver,
      overallDurationMinutes: test?.overallDurationMinutes || 0,
      papers: payload,
      currentPaperId:
        payload.find((p) => p.status === StudentPaperSessionStatus.IN_PROGRESS)?.paperId
        || payload.find((p) => !p.locked && p.status === StudentPaperSessionStatus.NOT_STARTED)?.paperId
        || null,
    };
  }

  // ─── HELPERS ───────────────────────────────────────────────
  private async getActiveParticipation(userId: string, testId: string): Promise<TestParticipation> {
    const p = await this.participationsRepo.findOne({ where: { userId, testId } });
    if (!p) throw new NotFoundException('No active session. Start the test first.');
    if (p.status !== ParticipationStatus.IN_PROGRESS) {
      throw new BadRequestException('Test already submitted');
    }
    return p;
  }

  private async calculateCodingScore(userId: string, testId: string): Promise<number> {
    const result = await this.submissionsRepo
      .createQueryBuilder('s')
      .select('s.question_id', 'questionId')
      .addSelect('MAX(s.score)', 'maxScore')
      .where('s.user_id = :userId', { userId })
      .andWhere('s.test_id = :testId', { testId })
      .andWhere('s.status = :status', { status: SubmissionStatus.COMPLETED })
      .groupBy('s.question_id')
      .getRawMany();
    return result.reduce((sum, r) => sum + parseFloat(r.maxScore || '0'), 0);
  }

  // ─── ADMIN: RESET TEST ATTEMPT ────────────────────────
  async resetTestAttempt(adminId: string, testId: string, userId: string) {
    const participation = await this.participationsRepo.findOne({
      where: { userId, testId },
    });
    if (!participation) throw new NotFoundException('No participation found for this user/test');

    participation.status = ParticipationStatus.RESET;
    participation.resetBy = adminId;
    participation.resetAt = new Date();
    await this.participationsRepo.save(participation);

    await this.redis.del(`timer:${userId}:${testId}`);

    this.logger.log(`Test reset by admin ${adminId} for user ${userId} on test ${testId}`);

    await this.logAction(null, userId, testId, ActionEventType.TEST_SUBMIT, {
      action: 'admin_reset',
      resetBy: adminId,
    });

    return { message: 'Test attempt reset. User can now re-take the test.', participationId: participation.id };
  }

  // ─── ACTION LOGGING (high-write) ──────────────────────
  async logAction(
    sessionId: string | null,
    userId: string,
    testId: string | null,
    eventType: ActionEventType,
    eventData?: Record<string, any>,
    ipAddress?: string,
  ) {
    const log = this.actionLogsRepo.create({
      sessionId,
      userId,
      testId,
      eventType,
      eventData: eventData || null,
      ipAddress: ipAddress || null,
    });
    await this.actionLogsRepo.save(log);
  }

  // ─── ADMIN: GET ACTION LOGS ───────────────────────────
  async getActionLogs(testId: string, page = 1, limit = 100) {
    const [logs, total] = await this.actionLogsRepo.findAndCount({
      where: { testId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { logs, total, page, limit };
  }
}
