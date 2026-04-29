import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestParticipation, ParticipationStatus } from './test-participation.entity';
import { Submission, SubmissionStatus } from '../submissions/submission.entity';
import { Test } from '../tests/test.entity';

@Injectable()
export class ResultsService {
  constructor(
    @InjectRepository(TestParticipation)
    private participationsRepo: Repository<TestParticipation>,
    @InjectRepository(Submission)
    private submissionsRepo: Repository<Submission>,
    @InjectRepository(Test)
    private testsRepo: Repository<Test>,
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
    const participation = await this.participationsRepo.findOne({
      where: { userId, testId },
      relations: ['user'],
    });
    if (!participation) throw new NotFoundException('Participation not found');

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
          bestScore: sub.score,
          totalAttempts: 0,
          lastSubmission: sub,
        });
      }
      const entry = questionScores.get(sub.questionId);
      entry.totalAttempts++;
    }

    return {
      participation,
      questions: Array.from(questionScores.values()),
      totalScore: participation.totalScore,
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
