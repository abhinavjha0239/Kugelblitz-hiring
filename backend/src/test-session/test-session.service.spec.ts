import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { TestSessionService } from './test-session.service';
import { McqResponse } from './mcq-response.entity';
import { ViolationLog } from './violation-log.entity';
import { ActionLog } from './action-log.entity';
import { TestParticipation, ParticipationStatus } from '../results/test-participation.entity';
import { Test as TestEntity } from '../tests/test.entity';
import { Question, QuestionType } from '../questions/question.entity';
import { Submission, SubmissionStatus } from '../submissions/submission.entity';
import { SubmissionProducer } from '../queue/submission.producer';

// ─── Mock Redis ─────────────────────────────────────────────
const mockRedis = {
  hmset: jest.fn().mockResolvedValue('OK'),
  hset: jest.fn().mockResolvedValue(1),
  hgetall: jest.fn().mockResolvedValue({}),
  expire: jest.fn().mockResolvedValue(1),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  rpush: jest.fn().mockResolvedValue(1),
  connect: jest.fn().mockResolvedValue(undefined),
};

jest.mock('ioredis', () => {
  const MockRedis = jest.fn().mockImplementation(() => mockRedis);
  return { __esModule: true, default: MockRedis };
});

// ─── Helpers ────────────────────────────────────────────────
type MockRepo<T extends object> = Partial<Record<keyof Repository<T>, jest.Mock>>;

function createMockRepo<T extends object>(): MockRepo<T> {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((dto) => ({ id: 'generated-uuid', ...dto })),
    save: jest.fn((entity) => Promise.resolve({ id: 'generated-uuid', ...entity })),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn(),
  };
}

// ─── Factories ──────────────────────────────────────────────
function makeTest(overrides: Partial<TestEntity> = {}): TestEntity {
  return {
    id: 'test-1',
    title: 'Sample Test',
    description: 'A sample test',
    durationMinutes: 60,
    isActive: true,
    hasSections: true,
    mcqCutoffPercent: 40,
    negativeMarkValue: 0.25,
    mcqTimeMinutes: 30,
    codingTimeMinutes: 30,
    totalMarks: 100,
    allowedLanguages: [71],
    ...overrides,
  } as TestEntity;
}

function makeParticipation(overrides: Partial<TestParticipation> = {}): TestParticipation {
  return {
    id: 'participation-1',
    userId: 'user-1',
    testId: 'test-1',
    startedAt: new Date(),
    submittedAt: null,
    totalScore: 0,
    mcqScore: 0,
    codingScore: 0,
    mcqSubmitted: false,
    codingUnlocked: false,
    autoSubmitted: false,
    currentSection: 'mcq',
    tabSwitchCount: 0,
    fullscreenExitCount: 0,
    status: ParticipationStatus.IN_PROGRESS,
    ipAddress: null,
    timePerQuestion: {},
    ...overrides,
  } as TestParticipation;
}

function makeMcqQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q-1',
    testId: 'test-1',
    type: QuestionType.MCQ,
    title: 'What is 2+2?',
    description: 'Choose the correct answer',
    marks: 10,
    orderIndex: 1,
    section: 1,
    allowedLanguages: [],
    mcqOptions: [
      { id: 'a', text: '3' },
      { id: 'b', text: '4' },
      { id: 'c', text: '5' },
      { id: 'd', text: '6' },
    ],
    mcqCorrectAnswer: 'b',
    negativeMarks: 0.25,
    ...overrides,
  } as Question;
}

function makeMcqResponse(overrides: Partial<McqResponse> = {}): McqResponse {
  return {
    id: 'resp-1',
    participationId: 'participation-1',
    userId: 'user-1',
    questionId: 'q-1',
    selectedOption: 'b',
    isCorrect: false,
    marksAwarded: 0,
    ...overrides,
  } as McqResponse;
}

// ═════════════════════════════════════════════════════════════
// TEST SUITE
// ═════════════════════════════════════════════════════════════
describe('TestSessionService — MCQ', () => {
  let service: TestSessionService;
  let participationsRepo: MockRepo<TestParticipation>;
  let testsRepo: MockRepo<TestEntity>;
  let questionsRepo: MockRepo<Question>;
  let mcqResponsesRepo: MockRepo<McqResponse>;
  let violationLogsRepo: MockRepo<ViolationLog>;
  let actionLogsRepo: MockRepo<ActionLog>;
  let submissionsRepo: MockRepo<Submission>;
  let submissionProducer: Partial<SubmissionProducer>;

  beforeEach(async () => {
    participationsRepo = createMockRepo<TestParticipation>();
    testsRepo = createMockRepo<TestEntity>();
    questionsRepo = createMockRepo<Question>();
    mcqResponsesRepo = createMockRepo<McqResponse>();
    violationLogsRepo = createMockRepo<ViolationLog>();
    actionLogsRepo = createMockRepo<ActionLog>();
    submissionsRepo = createMockRepo<Submission>();
    submissionProducer = { addSubmissionJob: jest.fn().mockResolvedValue('job-1') };

    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestSessionService,
        { provide: getRepositoryToken(TestParticipation), useValue: participationsRepo },
        { provide: getRepositoryToken(TestEntity), useValue: testsRepo },
        { provide: getRepositoryToken(Question), useValue: questionsRepo },
        { provide: getRepositoryToken(McqResponse), useValue: mcqResponsesRepo },
        { provide: getRepositoryToken(ViolationLog), useValue: violationLogsRepo },
        { provide: getRepositoryToken(ActionLog), useValue: actionLogsRepo },
        { provide: getRepositoryToken(Submission), useValue: submissionsRepo },
        { provide: SubmissionProducer, useValue: submissionProducer },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const map: Record<string, any> = {
                'redis.host': 'localhost',
                'redis.port': 6379,
                'redis.password': '',
              };
              return map[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<TestSessionService>(TestSessionService);
  });

  // ═══ startTest ════════════════════════════════════════════
  describe('startTest', () => {
    it('should initialize section to "mcq" when hasSections=true', async () => {
      testsRepo.findOne!.mockResolvedValue(makeTest({ hasSections: true }));
      participationsRepo.find!.mockResolvedValue([]);
      participationsRepo.create!.mockImplementation((dto) => dto);
      participationsRepo.save!.mockImplementation((e) => Promise.resolve({ id: 'p-1', ...e }));
      mockRedis.hgetall.mockResolvedValue({
        startedAt: new Date().toISOString(),
        totalSeconds: '3600',
        section: 'mcq',
      });

      const result = await service.startTest('user-1', 'test-1');

      expect(participationsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          currentSection: 'mcq',
          mcqSubmitted: false,
          codingUnlocked: false,
        }),
      );
      expect(result.participation).toBeDefined();
      expect(result.timer).toBeDefined();
    });

    it('should initialize section to "coding" when hasSections=false', async () => {
      testsRepo.findOne!.mockResolvedValue(makeTest({ hasSections: false }));
      participationsRepo.find!.mockResolvedValue([]);
      participationsRepo.create!.mockImplementation((dto) => dto);
      participationsRepo.save!.mockImplementation((e) => Promise.resolve({ id: 'p-1', ...e }));
      mockRedis.hgetall.mockResolvedValue({
        startedAt: new Date().toISOString(),
        totalSeconds: '3600',
        section: 'coding',
      });

      await service.startTest('user-1', 'test-1');

      expect(participationsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          currentSection: 'coding',
          mcqSubmitted: true,
          codingUnlocked: true,
        }),
      );
    });

    it('should resume an existing in-progress session', async () => {
      testsRepo.findOne!.mockResolvedValue(makeTest());
      const existing = makeParticipation();
      participationsRepo.find!.mockResolvedValue([existing]);
      mockRedis.hgetall.mockResolvedValue({
        startedAt: new Date().toISOString(),
        totalSeconds: '3600',
        section: 'mcq',
      });

      const result = await service.startTest('user-1', 'test-1');

      expect(participationsRepo.create).not.toHaveBeenCalled();
      expect(result.participation).toEqual(existing);
    });

    it('should throw NotFoundException for non-existent test', async () => {
      testsRepo.findOne!.mockResolvedValue(null);
      await expect(service.startTest('user-1', 'bad-id')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for inactive test', async () => {
      testsRepo.findOne!.mockResolvedValue(makeTest({ isActive: false }));
      await expect(service.startTest('user-1', 'test-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when test already completed', async () => {
      testsRepo.findOne!.mockResolvedValue(makeTest());
      participationsRepo.find!.mockResolvedValue([
        makeParticipation({ status: ParticipationStatus.SUBMITTED }),
      ]);
      await expect(service.startTest('user-1', 'test-1')).rejects.toThrow(BadRequestException);
    });

    it('should store correct mcqSeconds in Redis timer', async () => {
      testsRepo.findOne!.mockResolvedValue(makeTest({ durationMinutes: 90, mcqTimeMinutes: 30 }));
      participationsRepo.find!.mockResolvedValue([]);
      participationsRepo.create!.mockImplementation((dto) => dto);
      participationsRepo.save!.mockImplementation((e) => Promise.resolve({ id: 'p-1', ...e }));
      mockRedis.hgetall.mockResolvedValue({
        startedAt: new Date().toISOString(),
        totalSeconds: '5400',
        section: 'mcq',
      });

      await service.startTest('user-1', 'test-1');

      expect(mockRedis.hmset).toHaveBeenCalledWith(
        'timer:user-1:test-1',
        expect.objectContaining({
          totalSeconds: '5400',
          mcqSeconds: '1800',
        }),
      );
    });
  });

  // ═══ saveMcqAnswer ════════════════════════════════════════
  describe('saveMcqAnswer', () => {
    it('should save a new MCQ answer', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      questionsRepo.findOne!.mockResolvedValue(makeMcqQuestion());
      mcqResponsesRepo.findOne!.mockResolvedValue(null);
      mcqResponsesRepo.create!.mockImplementation((dto) => ({ id: 'r-new', ...dto }));
      mcqResponsesRepo.save!.mockImplementation((e) => Promise.resolve(e));

      const result = await service.saveMcqAnswer('user-1', 'test-1', 'q-1', 'b');

      expect(result).toEqual({ questionId: 'q-1', selectedOption: 'b', saved: true });
      expect(mcqResponsesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          participationId: 'participation-1',
          questionId: 'q-1',
          selectedOption: 'b',
        }),
      );
    });

    it('should update an existing answer (upsert)', async () => {
      const existing = makeMcqResponse({ selectedOption: 'a' });
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      questionsRepo.findOne!.mockResolvedValue(makeMcqQuestion());
      mcqResponsesRepo.findOne!.mockResolvedValue(existing);
      mcqResponsesRepo.save!.mockImplementation((e) => Promise.resolve(e));

      const result = await service.saveMcqAnswer('user-1', 'test-1', 'q-1', 'c');

      expect(result.selectedOption).toBe('c');
      expect(existing.selectedOption).toBe('c');
      expect(mcqResponsesRepo.create).not.toHaveBeenCalled();
    });

    it('should throw if MCQ already submitted', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation({ mcqSubmitted: true }));
      await expect(
        service.saveMcqAnswer('user-1', 'test-1', 'q-1', 'b'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw for a coding-type question', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      questionsRepo.findOne!.mockResolvedValue(makeMcqQuestion({ type: QuestionType.CODING }));
      await expect(
        service.saveMcqAnswer('user-1', 'test-1', 'q-1', 'b'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw for non-existent question', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      questionsRepo.findOne!.mockResolvedValue(null);
      await expect(
        service.saveMcqAnswer('user-1', 'test-1', 'no-q', 'b'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw for invalid option ID', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      questionsRepo.findOne!.mockResolvedValue(makeMcqQuestion());
      await expect(
        service.saveMcqAnswer('user-1', 'test-1', 'q-1', 'z'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when question has no options configured', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      questionsRepo.findOne!.mockResolvedValue(makeMcqQuestion({ mcqOptions: null }));
      await expect(
        service.saveMcqAnswer('user-1', 'test-1', 'q-1', 'b'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when no active session', async () => {
      participationsRepo.findOne!.mockResolvedValue(null);
      await expect(
        service.saveMcqAnswer('user-1', 'test-1', 'q-1', 'b'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ═══ submitMcqSection — Scoring Engine ════════════════════
  describe('submitMcqSection', () => {
    const q1 = makeMcqQuestion({ id: 'q-1', marks: 10, mcqCorrectAnswer: 'b', negativeMarks: 0.25 });
    const q2 = makeMcqQuestion({ id: 'q-2', marks: 10, mcqCorrectAnswer: 'c', negativeMarks: 0.5 });
    const q3 = makeMcqQuestion({ id: 'q-3', marks: 10, mcqCorrectAnswer: 'a', negativeMarks: 0 });
    const q4 = makeMcqQuestion({ id: 'q-4', marks: 10, mcqCorrectAnswer: 'd', negativeMarks: 0 });
    const q5 = makeMcqQuestion({ id: 'q-5', marks: 10, mcqCorrectAnswer: 'a', negativeMarks: 0 });
    const allQuestions = [q1, q2, q3, q4, q5];

    beforeEach(() => {
      questionsRepo.find!.mockResolvedValue(allQuestions);
      mcqResponsesRepo.save!.mockImplementation((e) => Promise.resolve(e));
      participationsRepo.save!.mockImplementation((e) => Promise.resolve(e));
    });

    it('should score 100% when all answers are correct, unlock coding', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      testsRepo.findOne!.mockResolvedValue(makeTest({ mcqCutoffPercent: 40, negativeMarkValue: 0 }));
      mcqResponsesRepo.find!.mockResolvedValue([
        makeMcqResponse({ questionId: 'q-1', selectedOption: 'b' }),
        makeMcqResponse({ questionId: 'q-2', selectedOption: 'c' }),
        makeMcqResponse({ questionId: 'q-3', selectedOption: 'a' }),
        makeMcqResponse({ questionId: 'q-4', selectedOption: 'd' }),
        makeMcqResponse({ questionId: 'q-5', selectedOption: 'a' }),
      ]);

      const result = await service.submitMcqSection('user-1', 'test-1');

      expect(result.mcqScore).toBe(50);
      expect(result.totalMcqMarks).toBe(50);
      expect(result.correct).toBe(5);
      expect(result.wrong).toBe(0);
      expect(result.unanswered).toBe(0);
      expect(result.mcqPercent).toBe(100);
      expect(result.cutoffMet).toBe(true);
      expect(result.codingUnlocked).toBe(true);
    });

    it('should apply per-question negative marks for wrong answers', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      testsRepo.findOne!.mockResolvedValue(makeTest({ mcqCutoffPercent: 40, negativeMarkValue: 0 }));
      mcqResponsesRepo.find!.mockResolvedValue([
        makeMcqResponse({ questionId: 'q-1', selectedOption: 'b' }),  // +10
        makeMcqResponse({ questionId: 'q-2', selectedOption: 'a' }),  // -0.5
        makeMcqResponse({ questionId: 'q-3', selectedOption: 'b' }),  // -0 (negativeMarks=0, test neg=0)
        makeMcqResponse({ questionId: 'q-4', selectedOption: 'a' }),  // -0
        makeMcqResponse({ questionId: 'q-5', selectedOption: 'a' }),  // +10
      ]);

      const result = await service.submitMcqSection('user-1', 'test-1');

      expect(result.mcqScore).toBe(19.5);
      expect(result.correct).toBe(2);
      expect(result.wrong).toBe(3);
    });

    it('should fallback to test-level negativeMarkValue when question has 0', async () => {
      questionsRepo.find!.mockResolvedValue([
        makeMcqQuestion({ id: 'q-3', marks: 10, mcqCorrectAnswer: 'a', negativeMarks: 0 }),
      ]);
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      testsRepo.findOne!.mockResolvedValue(makeTest({ negativeMarkValue: 2 }));
      mcqResponsesRepo.find!.mockResolvedValue([
        makeMcqResponse({ questionId: 'q-3', selectedOption: 'b' }),
      ]);

      const result = await service.submitMcqSection('user-1', 'test-1');

      // -2, floored to 0
      expect(result.mcqScore).toBe(0);
      expect(result.wrong).toBe(1);
    });

    it('should floor score at 0 when negatives exceed positives', async () => {
      questionsRepo.find!.mockResolvedValue([
        makeMcqQuestion({ id: 'q-1', marks: 5, mcqCorrectAnswer: 'a', negativeMarks: 50 }),
      ]);
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      testsRepo.findOne!.mockResolvedValue(makeTest({ negativeMarkValue: 0 }));
      mcqResponsesRepo.find!.mockResolvedValue([
        makeMcqResponse({ questionId: 'q-1', selectedOption: 'b' }),
      ]);

      const result = await service.submitMcqSection('user-1', 'test-1');
      expect(result.mcqScore).toBe(0);
    });

    it('should count unanswered questions correctly', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      testsRepo.findOne!.mockResolvedValue(makeTest({ mcqCutoffPercent: 0 }));
      mcqResponsesRepo.find!.mockResolvedValue([
        makeMcqResponse({ questionId: 'q-1', selectedOption: 'b' }),
      ]);

      const result = await service.submitMcqSection('user-1', 'test-1');

      expect(result.correct).toBe(1);
      expect(result.unanswered).toBe(4);
    });

    it('should NOT unlock coding when below cutoff', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      testsRepo.findOne!.mockResolvedValue(makeTest({ mcqCutoffPercent: 80 }));
      mcqResponsesRepo.find!.mockResolvedValue([
        makeMcqResponse({ questionId: 'q-1', selectedOption: 'b' }),
      ]);

      const result = await service.submitMcqSection('user-1', 'test-1');

      expect(result.cutoffMet).toBe(false);
      expect(result.codingUnlocked).toBe(false);
    });

    it('should unlock coding at exact cutoff boundary (40% = 40%)', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      testsRepo.findOne!.mockResolvedValue(makeTest({ mcqCutoffPercent: 40 }));
      mcqResponsesRepo.find!.mockResolvedValue([
        makeMcqResponse({ questionId: 'q-1', selectedOption: 'b' }),
        makeMcqResponse({ questionId: 'q-2', selectedOption: 'c' }),
      ]);

      const result = await service.submitMcqSection('user-1', 'test-1');

      expect(result.mcqPercent).toBe(40);
      expect(result.cutoffMet).toBe(true);
    });

    it('should persist mcqScore and mcqSubmitted on participation', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      testsRepo.findOne!.mockResolvedValue(makeTest({ mcqCutoffPercent: 0 }));
      mcqResponsesRepo.find!.mockResolvedValue([
        makeMcqResponse({ questionId: 'q-1', selectedOption: 'b' }),
      ]);

      await service.submitMcqSection('user-1', 'test-1');

      expect(participationsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ mcqSubmitted: true }),
      );
    });

    it('should mark each response with isCorrect and marksAwarded', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      testsRepo.findOne!.mockResolvedValue(makeTest({ mcqCutoffPercent: 0 }));
      const resp1 = makeMcqResponse({ questionId: 'q-1', selectedOption: 'b' });
      const resp2 = makeMcqResponse({ questionId: 'q-2', selectedOption: 'a' });
      mcqResponsesRepo.find!.mockResolvedValue([resp1, resp2]);

      await service.submitMcqSection('user-1', 'test-1');

      expect(resp1.isCorrect).toBe(true);
      expect(resp1.marksAwarded).toBe(10);
      expect(resp2.isCorrect).toBe(false);
      expect(resp2.marksAwarded).toBeLessThan(0);
    });

    it('should update Redis timer to "coding" when cutoff met', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      testsRepo.findOne!.mockResolvedValue(makeTest({ mcqCutoffPercent: 0 }));
      mcqResponsesRepo.find!.mockResolvedValue([]);

      await service.submitMcqSection('user-1', 'test-1');

      expect(mockRedis.hset).toHaveBeenCalledWith('timer:user-1:test-1', 'section', 'coding');
    });

    it('should NOT update Redis timer when cutoff not met', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      testsRepo.findOne!.mockResolvedValue(makeTest({ mcqCutoffPercent: 100 }));
      mcqResponsesRepo.find!.mockResolvedValue([]);
      mockRedis.hset.mockClear();

      await service.submitMcqSection('user-1', 'test-1');

      expect(mockRedis.hset).not.toHaveBeenCalledWith(expect.anything(), 'section', 'coding');
    });

    it('should throw if MCQ already submitted', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation({ mcqSubmitted: true }));
      await expect(service.submitMcqSection('user-1', 'test-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when test not found', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      testsRepo.findOne!.mockResolvedValue(null);
      await expect(service.submitMcqSection('user-1', 'test-1')).rejects.toThrow(NotFoundException);
    });

    it('should handle zero MCQ questions edge case', async () => {
      questionsRepo.find!.mockResolvedValue([]);
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      testsRepo.findOne!.mockResolvedValue(makeTest({ mcqCutoffPercent: 0 }));
      mcqResponsesRepo.find!.mockResolvedValue([]);

      const result = await service.submitMcqSection('user-1', 'test-1');

      expect(result.mcqScore).toBe(0);
      expect(result.totalMcqMarks).toBe(0);
    });
  });

  // ═══ getSessionStatus ═════════════════════════════════════
  describe('getSessionStatus', () => {
    it('should return MCQ questions with saved answers', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation({ codingUnlocked: false }));
      testsRepo.findOne!.mockResolvedValue(makeTest());
      mockRedis.hgetall.mockResolvedValue({
        startedAt: new Date().toISOString(),
        totalSeconds: '3600',
        section: 'mcq',
      });

      questionsRepo.find!
        .mockResolvedValueOnce([makeMcqQuestion()])
        .mockResolvedValueOnce([]);

      mcqResponsesRepo.find!.mockResolvedValue([
        makeMcqResponse({ questionId: 'q-1', selectedOption: 'b' }),
      ]);

      const result = await service.getSessionStatus('user-1', 'test-1') as any;

      expect(result.mcqQuestions).toHaveLength(1);
      expect(result.savedAnswers).toEqual({ 'q-1': 'b' });
      expect(result.codingQuestions).toEqual([]);
    });

    it('should return coding questions when unlocked', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation({ codingUnlocked: true }));
      testsRepo.findOne!.mockResolvedValue(makeTest());
      mockRedis.hgetall.mockResolvedValue({
        startedAt: new Date().toISOString(),
        totalSeconds: '3600',
        section: 'coding',
      });

      const codingQ = {
        ...makeMcqQuestion({ id: 'cq-1', type: QuestionType.CODING, section: 2 }),
        testCases: [{ id: 'tc-1', input: '1', expectedOutput: '2', isHidden: false }],
      };
      questionsRepo.find!
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([codingQ]);
      mcqResponsesRepo.find!.mockResolvedValue([]);

      const result = await service.getSessionStatus('user-1', 'test-1') as any;

      expect(result.codingQuestions).toHaveLength(1);
    });

    it('should filter hidden test cases', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation({ codingUnlocked: true }));
      testsRepo.findOne!.mockResolvedValue(makeTest());
      mockRedis.hgetall.mockResolvedValue({
        startedAt: new Date().toISOString(),
        totalSeconds: '3600',
        section: 'coding',
      });

      const codingQ = {
        ...makeMcqQuestion({ id: 'cq-1', type: QuestionType.CODING, section: 2 }),
        testCases: [
          { id: 'tc-1', input: '1', expectedOutput: '2', isHidden: false },
          { id: 'tc-2', input: '3', expectedOutput: '4', isHidden: true },
        ],
      };
      questionsRepo.find!
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([codingQ]);
      mcqResponsesRepo.find!.mockResolvedValue([]);

      const result = await service.getSessionStatus('user-1', 'test-1') as any;

      expect(result.codingQuestions[0].testCases).toHaveLength(1);
      expect(result.codingQuestions[0].testCases[0].isHidden).toBe(false);
    });

    it('should throw NotFoundException for missing session', async () => {
      participationsRepo.findOne!.mockResolvedValue(null);
      await expect(service.getSessionStatus('user-1', 'test-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ═══ submitCoding ═════════════════════════════════════════
  describe('submitCoding', () => {
    it('should throw ForbiddenException when coding is locked', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation({ codingUnlocked: false }));
      await expect(
        service.submitCoding('user-1', 'test-1', 'q-1', 71, 'print("hi")'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should create submission and enqueue when unlocked', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation({ codingUnlocked: true }));
      mockRedis.get.mockResolvedValue(null);
      submissionsRepo.create!.mockImplementation((dto) => ({ id: 'sub-1', ...dto }));
      submissionsRepo.save!.mockImplementation((e) => Promise.resolve(e));

      await service.submitCoding('user-1', 'test-1', 'q-1', 71, 'print("hi")');

      expect(submissionsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          sourceCode: 'print("hi")',
          isFinal: true,
        }),
      );
      expect(submissionProducer.addSubmissionJob).toHaveBeenCalled();
    });

    it('should enforce 3-second rate limit', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation({ codingUnlocked: true }));
      mockRedis.get.mockResolvedValue((Date.now() - 1000).toString());

      await expect(
        service.submitCoding('user-1', 'test-1', 'q-1', 71, 'x'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ═══ finalSubmit ══════════════════════════════════════════
  describe('finalSubmit', () => {
    it('should combine MCQ + coding into totalScore', async () => {
      const participation = makeParticipation({ mcqScore: 30, mcqSubmitted: true });
      participationsRepo.findOne!.mockResolvedValue(participation);
      participationsRepo.save!.mockImplementation((e) => Promise.resolve(e));

      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ maxScore: '20' }]),
      };
      submissionsRepo.createQueryBuilder!.mockReturnValue(qb);

      const result = await service.finalSubmit('user-1', 'test-1', false);

      expect(result.mcqScore).toBe(30);
      expect(result.codingScore).toBe(20);
      expect(result.totalScore).toBe(50);
    });

    it('should set TIMED_OUT when isAutoSubmit=true', async () => {
      const participation = makeParticipation({ mcqSubmitted: true });
      participationsRepo.findOne!.mockResolvedValue(participation);
      participationsRepo.save!.mockImplementation((e) => Promise.resolve(e));

      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      submissionsRepo.createQueryBuilder!.mockReturnValue(qb);

      const result = await service.finalSubmit('user-1', 'test-1', true);

      expect(result.participation.status).toBe(ParticipationStatus.TIMED_OUT);
      expect(result.participation.autoSubmitted).toBe(true);
    });
  });

  // ═══ getTimerState ════════════════════════════════════════
  describe('getTimerState', () => {
    it('should return remaining time from Redis', async () => {
      const startedAt = new Date(Date.now() - 60000);
      mockRedis.hgetall.mockResolvedValue({
        startedAt: startedAt.toISOString(),
        totalSeconds: '3600',
        mcqSeconds: '3600',
        section: 'mcq',
      });

      const result = await service.getTimerState('user-1', 'test-1');

      expect(result.remaining).toBeGreaterThan(3530);
      expect(result.remaining).toBeLessThanOrEqual(3540);
      expect(result.section).toBe('mcq');
    });

    it('should fallback to DB when Redis empty', async () => {
      mockRedis.hgetall.mockResolvedValue({});
      participationsRepo.findOne!.mockResolvedValue(
        makeParticipation({ startedAt: new Date(Date.now() - 120000), currentSection: 'coding' }),
      );
      testsRepo.findOne!.mockResolvedValue(makeTest({ durationMinutes: 60 }));

      const result = await service.getTimerState('user-1', 'test-1');

      expect(result.remaining).toBeGreaterThan(3470);
      expect(result.section).toBe('coding');
    });

    it('should return 0 when time expired', async () => {
      mockRedis.hgetall.mockResolvedValue({
        startedAt: new Date(Date.now() - 999999000).toISOString(),
        totalSeconds: '3600',
        section: 'mcq',
      });

      const result = await service.getTimerState('user-1', 'test-1');
      expect(result.remaining).toBe(0);
    });
  });

  // ═══ trackQuestionTime ════════════════════════════════════
  describe('trackQuestionTime', () => {
    it('should accumulate time for a question', async () => {
      const participation = makeParticipation({ timePerQuestion: { 'q-1': 10 } });
      participationsRepo.findOne!.mockResolvedValue(participation);
      participationsRepo.save!.mockImplementation((e) => Promise.resolve(e));

      const result = await service.trackQuestionTime('user-1', 'test-1', 'q-1', 5);

      expect(result.totalTime).toBe(15);
    });

    it('should log violation for rapid answering (<3s)', async () => {
      participationsRepo.findOne!.mockResolvedValue(makeParticipation());
      participationsRepo.save!.mockImplementation((e) => Promise.resolve(e));
      violationLogsRepo.create!.mockImplementation((dto) => dto);
      violationLogsRepo.save!.mockImplementation((e) => Promise.resolve(e));

      await service.trackQuestionTime('user-1', 'test-1', 'q-1', 2);

      expect(violationLogsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'rapid_answer' }),
      );
    });
  });

  // ═══ logAntiCheat ═════════════════════════════════════════
  describe('logAntiCheat', () => {
    it('should increment tabSwitchCount', async () => {
      const participation = makeParticipation({ tabSwitchCount: 0 });
      participationsRepo.findOne!.mockResolvedValue(participation);
      participationsRepo.save!.mockImplementation((e) => Promise.resolve(e));
      violationLogsRepo.create!.mockImplementation((dto) => dto);
      violationLogsRepo.save!.mockImplementation((e) => Promise.resolve(e));

      await service.logAntiCheat('user-1', 'test-1', 'tab_switch');

      expect(participation.tabSwitchCount).toBe(1);
      expect(violationLogsRepo.create).toHaveBeenCalled();
    });

    it('should persist violation log with IP address', async () => {
      const participation = makeParticipation();
      participationsRepo.findOne!.mockResolvedValue(participation);
      participationsRepo.save!.mockImplementation((e) => Promise.resolve(e));
      violationLogsRepo.create!.mockImplementation((dto) => dto);
      violationLogsRepo.save!.mockImplementation((e) => Promise.resolve(e));

      await service.logAntiCheat('user-1', 'test-1', 'copy_paste', '192.168.1.1');

      expect(violationLogsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'copy_paste',
          ipAddress: '192.168.1.1',
        }),
      );
    });
  });
});
