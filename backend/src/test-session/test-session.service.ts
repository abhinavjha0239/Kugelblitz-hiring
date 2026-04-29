import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
import {
  StudentPaperSession,
  StudentPaperSessionStatus,
} from '../paper/student-paper-session.entity';

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
    private submissionProducer: SubmissionProducer,
    private configService: ConfigService,
    private paperService: PaperService,
    private randomizationService: RandomizationService,
    private paperSessionCacheService: PaperSessionCacheService,
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

  // ─── START TEST ────────────────────────────────────────────
  async startTest(userId: string, testId: string) {
    const test = await this.testsRepo.findOne({ where: { id: testId } });
    if (!test) throw new NotFoundException('Test not found');
    if (!test.isActive) throw new BadRequestException('Test is not active');

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

    let participation: any;
    const now = new Date();
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
      });
      participation = await this.participationsRepo.save(participation);
    } catch (err: any) {
      if (err.code === 'ER_DUP_ENTRY' || err.code === '23505' || err.message?.includes('Duplicate entry')) {
        const retry = await this.participationsRepo.findOne({
          where: { userId, testId, status: ParticipationStatus.IN_PROGRESS },
        });
        if (retry) {
          const timer = await this.getTimerState(userId, testId);
          return { participation: retry, timer };
        }
        throw new BadRequestException('Failed to start test. Please try again.');
      }
      throw err;
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
    await this.redis.expire(timerKey, totalSeconds + 300);

    const timer = await this.getTimerState(userId, testId);
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
      return this.autoSubmit(userId, testId);
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
      await this.mcqResponsesRepo.save(resp);

      if (isCorrect) correct++;
      else wrong++;
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
    if (!participation.codingUnlocked) {
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
    const participation = await this.participationsRepo.findOne({
      where: { userId, testId },
    });
    if (!participation) throw new NotFoundException('No active session');
    if (participation.status !== ParticipationStatus.IN_PROGRESS) {
      return { participation, message: 'Test already submitted' };
    }

    if (!participation.mcqSubmitted) {
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

    current.codingScore = codingScore;
    current.totalScore = Number(current.mcqScore) + codingScore;
    current.submittedAt = new Date();
    current.status = isAutoSubmit ? ParticipationStatus.TIMED_OUT : ParticipationStatus.SUBMITTED;
    current.autoSubmitted = isAutoSubmit;
    await this.participationsRepo.save(current);

    await this.redis.del(`timer:${userId}:${testId}`);

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
    await this.startTest(userId, testId);
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
  }

  // ─── MULTI-PAPER: START PAPER ──────────────────────────────
  async startPaper(userId: string, paperId: string) {
    const paper = await this.paperService.getPaperById(paperId);
    const participation = await this.getActiveParticipation(userId, paper.examId);
    const papers = await this.paperService.listExamPapers(paper.examId);
    await this.paperService.ensurePaperSessionsForSession(participation.id, papers);

    const sessions = await this.paperService.getStudentPaperSessions(participation.id);
    const targetSession = sessions.find((s) => s.paperId === paperId);
    if (!targetSession) throw new NotFoundException('Paper session not found');

    const previousPapers = sessions.filter((s) => (s.paper?.order || 0) < (paper.order || 0));
    const blocked = previousPapers.find((s) => s.status !== StudentPaperSessionStatus.SUBMITTED);
    if (blocked) {
      throw new ForbiddenException('Previous paper must be submitted before starting this paper');
    }
    if (targetSession.status === StudentPaperSessionStatus.SUBMITTED) {
      throw new BadRequestException('Paper already submitted');
    }

    if (targetSession.status === StudentPaperSessionStatus.NOT_STARTED) {
      targetSession.status = StudentPaperSessionStatus.IN_PROGRESS;
      targetSession.startedAt = new Date();
      await this.studentPaperSessionsRepo.save(targetSession);
    }

    let cached = await this.paperSessionCacheService.getPaperSession(userId, paperId);
    if (!cached) {
      const pool = await this.paperService.getPaperQuestions(paperId);
      const randomized = this.randomizationService.shuffleQuestionsByStudent(
        pool,
        userId,
        paperId,
        paper.totalQuestions,
      );
      const { rendered, answerKey } = this.randomizationService.buildRenderedQuestions(randomized, userId);
      cached = {
        paperSessionId: targetSession.id,
        testId: paper.examId,
        paperId,
        userId,
        generatedAt: new Date().toISOString(),
        questions: rendered,
        answerKey,
      };
      await this.paperSessionCacheService.setPaperSession(cached);
    }

    const autosavedAnswers = await this.paperSessionCacheService.getAutosavedAnswers(userId, paperId);
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
    };
  }

  async autosavePaperAnswers(userId: string, paperId: string, answers: Record<string, string>) {
    const paper = await this.paperService.getPaperById(paperId);
    const participation = await this.getActiveParticipation(userId, paper.examId);
    const sessions = await this.paperService.getStudentPaperSessions(participation.id);
    const target = sessions.find((s) => s.paperId === paperId);
    if (!target || target.status !== StudentPaperSessionStatus.IN_PROGRESS) {
      throw new BadRequestException('Paper is not in progress');
    }
    await this.paperSessionCacheService.setAutosavedAnswers(userId, paperId, answers);
    return { saved: true, count: Object.keys(answers || {}).length };
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

    const cached = await this.paperSessionCacheService.getPaperSession(userId, paperId);
    if (!cached) {
      throw new BadRequestException('Paper question set not initialized. Start paper first.');
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
      const selected = answers[questionId];
      const isCorrect = selected && expected ? selected === expected : false;
      const marksAwarded = isCorrect ? Number(question.marks || 0) : 0;
      score += marksAwarded;
      records.push(
        this.mcqResponsesRepo.create({
          participationId: participation.id,
          userId,
          questionId,
          selectedOption: selected || '',
          isCorrect,
          marksAwarded,
        }),
      );
    }
    if (records.length > 0) {
      await this.mcqResponsesRepo.save(records);
    }

    target.score = score;
    target.status = StudentPaperSessionStatus.SUBMITTED;
    target.submittedAt = new Date();
    await this.studentPaperSessionsRepo.save(target);

    const orderedSessions = [...sessions].sort((a, b) => (a.paper?.order || 0) - (b.paper?.order || 0));
    const nextSession = orderedSessions.find((s) => (s.paper?.order || 0) === (paper.order + 1));
    const allSubmitted = orderedSessions.every((s) =>
      s.paperId === target.paperId || s.status === StudentPaperSessionStatus.SUBMITTED,
    );

    participation.totalScore = Number(participation.totalScore || 0) + score;
    if (allSubmitted) {
      participation.status = ParticipationStatus.SUBMITTED;
      participation.submittedAt = new Date();
    }
    await this.participationsRepo.save(participation);

    return {
      paperSession: target,
      score,
      totalMarks,
      nextPaperId: nextSession?.paperId || null,
      unlockedNextPaper: !!nextSession,
      examCompleted: allSubmitted,
    };
  }

  async getExamStatus(userId: string, testId: string) {
    const participation = await this.participationsRepo.findOne({ where: { userId, testId } });
    if (!participation) throw new NotFoundException('No exam session found');

    const papers = await this.paperService.listExamPapers(testId);
    const paperSessions = await this.paperService.getStudentPaperSessions(participation.id);

    const mapByPaperId = new Map(paperSessions.map((s) => [s.paperId, s]));
    const payload = papers.map((paper) => {
      const ps = mapByPaperId.get(paper.id);
      const previousSubmitted = papers
        .filter((p) => p.order < paper.order)
        .every((p) => mapByPaperId.get(p.id)?.status === StudentPaperSessionStatus.SUBMITTED);
      const startedAt = ps?.startedAt ? new Date(ps.startedAt).getTime() : null;
      const elapsed = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
      const remaining = Math.max(0, paper.durationMinutes * 60 - elapsed);

      return {
        paperId: paper.id,
        name: paper.name,
        order: paper.order,
        durationMinutes: paper.durationMinutes,
        totalQuestions: paper.totalQuestions,
        passRequired: paper.passRequired,
        status: ps?.status || StudentPaperSessionStatus.NOT_STARTED,
        locked: !previousSubmitted && paper.order > 1,
        startedAt: ps?.startedAt || null,
        submittedAt: ps?.submittedAt || null,
        remainingSeconds: ps?.status === StudentPaperSessionStatus.IN_PROGRESS ? remaining : null,
      };
    });

    return {
      participation,
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
