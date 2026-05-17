import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TestParticipation, ParticipationStatus } from './test-participation.entity';
import { Submission, SubmissionStatus } from '../submissions/submission.entity';
import { Test } from '../tests/test.entity';
import { Question } from '../questions/question.entity';
import { McqResponse } from '../test-session/mcq-response.entity';
import { ViolationLog } from '../test-session/violation-log.entity';
import { Paper } from '../paper/paper.entity';
import { StudentPaperSession } from '../paper/student-paper-session.entity';

@Injectable()
export class ResultsService {
  constructor(
    @InjectRepository(TestParticipation)
    private participationsRepo: Repository<TestParticipation>,
    @InjectRepository(Submission)
    private submissionsRepo: Repository<Submission>,
    @InjectRepository(Test)
    private testsRepo: Repository<Test>,
    @InjectRepository(Question)
    private questionsRepo: Repository<Question>,
    @InjectRepository(McqResponse)
    private mcqResponsesRepo: Repository<McqResponse>,
    @InjectRepository(ViolationLog)
    private violationsRepo: Repository<ViolationLog>,
    @InjectRepository(Paper)
    private papersRepo: Repository<Paper>,
    @InjectRepository(StudentPaperSession)
    private paperSessionsRepo: Repository<StudentPaperSession>,
  ) {}

  async startTest(userId: string, testId: string): Promise<TestParticipation> {
    const test = await this.testsRepo.findOne({ where: { id: testId } });
    if (!test) throw new NotFoundException('Test not found');
    if (!test.isActive) throw new BadRequestException('Test is not active');

    const existing = await this.participationsRepo.findOne({
      where: { userId, testId },
    });

    if (existing) {
      if (existing.status !== ParticipationStatus.IN_PROGRESS) {
        throw new BadRequestException('You have already completed this test');
      }
      return existing;
    }

    const participation = this.participationsRepo.create({
      userId,
      testId,
      startedAt: new Date(),
      status: ParticipationStatus.IN_PROGRESS,
    });
    return this.participationsRepo.save(participation);
  }

  async submitTest(userId: string, testId: string): Promise<TestParticipation> {
    const participation = await this.participationsRepo.findOne({
      where: { userId, testId },
    });
    if (!participation) throw new NotFoundException('Test participation not found');
    if (participation.status !== ParticipationStatus.IN_PROGRESS) {
      throw new BadRequestException('Test already submitted');
    }

    const totalScore = await this.calculateScore(userId, testId);

    participation.submittedAt = new Date();
    participation.status = ParticipationStatus.SUBMITTED;
    participation.totalScore = totalScore;
    return this.participationsRepo.save(participation);
  }

  async reportAntiCheat(
    userId: string,
    testId: string,
    type: 'tab_switch' | 'fullscreen_exit',
  ): Promise<void> {
    const participation = await this.participationsRepo.findOne({
      where: { userId, testId },
    });
    if (!participation) return;

    if (type === 'tab_switch') {
      participation.tabSwitchCount += 1;
    } else {
      participation.fullscreenExitCount += 1;
    }
    await this.participationsRepo.save(participation);
  }

  async getParticipation(userId: string, testId: string): Promise<TestParticipation | null> {
    return this.participationsRepo.findOne({
      where: { userId, testId },
    });
  }

  async getTestMonitor(testId: string): Promise<any> {
    const participations = await this.participationsRepo.find({
      where: { testId },
      relations: ['user'],
      order: { startedAt: 'ASC' },
    });

    const test = await this.testsRepo.findOne({ where: { id: testId } });

    return {
      test,
      participants: participations.map((p) => ({
        id: p.id,
        userId: p.userId,
        userName: `${p.user.firstName} ${p.user.lastName}`,
        email: p.user.email,
        status: p.status,
        startedAt: p.startedAt,
        submittedAt: p.submittedAt,
        totalScore: p.totalScore,
        tabSwitchCount: p.tabSwitchCount,
        fullscreenExitCount: p.fullscreenExitCount,
        remainingTime: this.calculateRemainingTime(p, test!.durationMinutes),
      })),
      totalParticipants: participations.length,
      submitted: participations.filter((p) => p.status === ParticipationStatus.SUBMITTED).length,
      inProgress: participations.filter((p) => p.status === ParticipationStatus.IN_PROGRESS).length,
    };
  }

  async getLeaderboard(testId: string): Promise<any[]> {
    const participations = await this.participationsRepo.find({
      where: { testId, status: ParticipationStatus.SUBMITTED },
      relations: ['user'],
      order: { totalScore: 'DESC', submittedAt: 'ASC' },
    });

    const test = await this.testsRepo.findOne({ where: { id: testId } });

    return participations.map((p, index) => ({
      rank: index + 1,
      userId: p.userId,
      name: `${p.user.firstName} ${p.user.lastName}`,
      email: p.user.email,
      totalScore: p.totalScore,
      totalPossible: test?.totalMarks || 0,
      submittedAt: p.submittedAt,
      timeTaken: p.submittedAt
        ? Math.round((new Date(p.submittedAt).getTime() - new Date(p.startedAt).getTime()) / 60000)
        : null,
    }));
  }

  async getDetailedResult(userId: string, testId: string): Promise<any> {
    // Always pick the latest attempt (ordering by attemptNumber DESC) so admin
    // resets / re-attempts don't surface a stale RESET row.
    const participation = await this.participationsRepo.findOne({
      where: { userId, testId },
      order: { attemptNumber: 'DESC' },
      relations: ['user'],
    });
    if (!participation) throw new NotFoundException('Participation not found');

    const test = await this.testsRepo.findOne({ where: { id: testId } });

    // ─── Coding submissions (best score per question) ─────────
    const submissions = await this.submissionsRepo.find({
      where: { userId, testId },
      relations: ['question'],
      order: { createdAt: 'DESC' },
    });
    const questionScores = new Map<string, any>();
    for (const sub of submissions) {
      if (!questionScores.has(sub.questionId) || sub.score > questionScores.get(sub.questionId).score) {
        questionScores.set(sub.questionId, {
          questionId: sub.questionId,
          questionTitle: sub.question?.title,
          questionMarks: Number(sub.question?.marks ?? 0),
          questionType: 'coding',
          bestScore: Number(sub.score),
          totalAttempts: 0,
          lastSubmission: sub,
        });
      }
      const entry = questionScores.get(sub.questionId);
      entry.totalAttempts++;
    }

    // ─── MCQ responses ────────────────────────────────────────
    const mcqResponses = await this.mcqResponsesRepo.find({
      where: { participationId: participation.id },
      order: { createdAt: 'ASC' },
    });
    const mcqQuestionIds = mcqResponses.map((r) => r.questionId);
    const mcqQuestions = mcqQuestionIds.length
      ? await this.questionsRepo.find({ where: { id: In(mcqQuestionIds) } })
      : [];
    const mcqQById = new Map(mcqQuestions.map((q) => [q.id, q]));
    const mcqBreakdown = mcqResponses.map((r) => {
      const q = mcqQById.get(r.questionId);
      return {
        questionId: r.questionId,
        title: q?.title ?? '(unknown)',
        description: q?.description ?? '',
        options: q?.mcqOptions ?? [],
        correctAnswer: q?.mcqCorrectAnswer ?? null,
        selectedOption: r.selectedOption ?? null,
        isCorrect: r.isCorrect,
        marksAwarded: Number(r.marksAwarded),
        questionMarks: Number(q?.marks ?? 0),
        section: q?.section ?? null,
      };
    });

    // ─── Paper-based breakdown (if exam uses papers) ──────────
    const papers = await this.papersRepo.find({ where: { examId: testId }, order: { order: 'ASC' } });
    const paperSessions = papers.length
      ? await this.paperSessionsRepo.find({
          where: { sessionId: participation.id },
          relations: ['paper'],
        })
      : [];
    const paperBreakdown = papers.map((p) => {
      const ps = paperSessions.find((s) => s.paperId === p.id);
      const elapsedMin = ps?.startedAt && ps?.submittedAt
        ? Math.round((new Date(ps.submittedAt).getTime() - new Date(ps.startedAt).getTime()) / 60_000)
        : null;
      return {
        paperId: p.id,
        name: p.name,
        order: p.order,
        durationMinutes: p.durationMinutes,
        cutoffType: p.cutoffType,
        cutoffValue: Number(p.cutoffValue),
        cutoffFailBehavior: p.cutoffFailBehavior,
        score: ps ? Number(ps.score) : 0,
        totalMarks: p.totalMarks,
        cutoffPassed: ps?.cutoffPassed ?? null,
        status: ps?.status ?? 'not_started',
        timeTakenMin: elapsedMin,
      };
    });

    // ─── Proctoring summary ────────────────────────────────────
    const violations = await this.violationsRepo.find({
      where: { participationId: participation.id },
      order: { createdAt: 'DESC' },
    });
    const violationCounts: Record<string, number> = {};
    for (const v of violations) {
      violationCounts[v.type] = (violationCounts[v.type] || 0) + 1;
    }
    const proctoring = {
      riskScore: participation.riskScore || 0,
      tabSwitchCount: participation.tabSwitchCount || 0,
      fullscreenExitCount: participation.fullscreenExitCount || 0,
      copyPasteCount: participation.copyPasteCount || 0,
      totalViolations: violations.length,
      violationCounts,
      recent: violations.slice(0, 10).map((v) => ({
        type: v.type,
        createdAt: v.createdAt,
      })),
    };

    // Derive MCQ + coding totals from the actual breakdown (paper-flow doesn't
    // touch participation.mcqScore/codingScore so those fields can be stale).
    const derivedMcqScore = mcqBreakdown.reduce((s, r) => s + Number(r.marksAwarded || 0), 0);
    const derivedCodingScore = Array.from(questionScores.values()).reduce(
      (s: number, c: any) => s + Number(c.bestScore || 0),
      0,
    );

    return {
      test: test
        ? { id: test.id, title: test.title, description: test.description, totalMarks: test.totalMarks, durationMinutes: test.durationMinutes }
        : null,
      participation,
      totalScore: Number(participation.totalScore),
      mcqScore: derivedMcqScore || Number(participation.mcqScore),
      codingScore: derivedCodingScore || Number(participation.codingScore),
      papers: paperBreakdown,
      mcq: mcqBreakdown,
      coding: Array.from(questionScores.values()),
      proctoring,
    };
  }

  private async calculateScore(userId: string, testId: string): Promise<number> {
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

  private calculateRemainingTime(participation: TestParticipation, durationMinutes: number): number | null {
    if (participation.status !== ParticipationStatus.IN_PROGRESS) return null;
    const elapsed = (Date.now() - new Date(participation.startedAt).getTime()) / 1000;
    const remaining = durationMinutes * 60 - elapsed;
    return Math.max(0, Math.round(remaining));
  }
}
