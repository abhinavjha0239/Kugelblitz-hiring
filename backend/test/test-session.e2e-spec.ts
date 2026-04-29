import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { TestSessionService } from '../src/test-session/test-session.service';
import { TestParticipation, ParticipationStatus } from '../src/results/test-participation.entity';
import { Test as TestEntity } from '../src/tests/test.entity';
import { Question, QuestionType } from '../src/questions/question.entity';
import { McqResponse } from '../src/test-session/mcq-response.entity';
import { ViolationLog } from '../src/test-session/violation-log.entity';
import { ActionLog } from '../src/test-session/action-log.entity';
import { Submission } from '../src/submissions/submission.entity';
import { SubmissionProducer } from '../src/queue/submission.producer';

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

function createMockRepo() {
  return {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((dto) => ({ id: 'uuid', ...dto })),
    save: jest.fn((entity) => Promise.resolve({ id: 'uuid', ...entity })),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn(),
  };
}

/**
 * E2E test for the full MCQ flow:
 * start test → save answers → submit MCQ → verify scoring → section lock
 *
 * Uses a real NestJS app with mocked repositories (no DB/Redis needed).
 * Guards are disabled to isolate the test-session module logic.
 */
describe('TestSession E2E — MCQ Flow', () => {
  let app: INestApplication;
  let participationsRepo: ReturnType<typeof createMockRepo>;
  let testsRepo: ReturnType<typeof createMockRepo>;
  let questionsRepo: ReturnType<typeof createMockRepo>;
  let mcqResponsesRepo: ReturnType<typeof createMockRepo>;
  let violationLogsRepo: ReturnType<typeof createMockRepo>;
  let submissionsRepo: ReturnType<typeof createMockRepo>;

  const testEntity = {
    id: 'test-1',
    title: 'MCQ E2E Test',
    description: 'E2E test',
    durationMinutes: 60,
    isActive: true,
    hasSections: true,
    mcqCutoffPercent: 50,
    negativeMarkValue: 0,
    mcqTimeMinutes: 30,
    codingTimeMinutes: 30,
    totalMarks: 30,
    allowedLanguages: [71],
  };

  const questions = [
    {
      id: 'q1', testId: 'test-1', type: QuestionType.MCQ, title: 'Q1',
      description: 'desc', marks: 10, orderIndex: 1, section: 1, negativeMarks: 0,
      mcqOptions: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }],
      mcqCorrectAnswer: 'a', allowedLanguages: [],
    },
    {
      id: 'q2', testId: 'test-1', type: QuestionType.MCQ, title: 'Q2',
      description: 'desc', marks: 10, orderIndex: 2, section: 1, negativeMarks: 1,
      mcqOptions: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }],
      mcqCorrectAnswer: 'b', allowedLanguages: [],
    },
    {
      id: 'q3', testId: 'test-1', type: QuestionType.MCQ, title: 'Q3',
      description: 'desc', marks: 10, orderIndex: 3, section: 1, negativeMarks: 0,
      mcqOptions: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }],
      mcqCorrectAnswer: 'a', allowedLanguages: [],
    },
  ];

  const participation = {
    id: 'p-1',
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
  };

  beforeAll(async () => {
    participationsRepo = createMockRepo();
    testsRepo = createMockRepo();
    questionsRepo = createMockRepo();
    mcqResponsesRepo = createMockRepo();
    violationLogsRepo = createMockRepo();
    submissionsRepo = createMockRepo();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        TestSessionService,
        { provide: getRepositoryToken(TestParticipation), useValue: participationsRepo },
        { provide: getRepositoryToken(TestEntity), useValue: testsRepo },
        { provide: getRepositoryToken(Question), useValue: questionsRepo },
        { provide: getRepositoryToken(McqResponse), useValue: mcqResponsesRepo },
        { provide: getRepositoryToken(ViolationLog), useValue: violationLogsRepo },
        { provide: getRepositoryToken(ActionLog), useValue: createMockRepo() },
        { provide: getRepositoryToken(Submission), useValue: submissionsRepo },
        { provide: SubmissionProducer, useValue: { addSubmissionJob: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const m: Record<string, any> = { 'redis.host': 'localhost', 'redis.port': 6379, 'redis.password': '' };
              return m[key];
            }),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Full MCQ Flow (direct service calls)', () => {
    let service: TestSessionService;

    beforeAll(() => {
      service = app.get(TestSessionService);
    });

    it('Step 1: Start test → returns participation with mcq section', async () => {
      testsRepo.findOne.mockResolvedValue(testEntity);
      participationsRepo.find.mockResolvedValue([]);
      participationsRepo.create.mockImplementation((dto) => ({ ...participation, ...dto }));
      participationsRepo.save.mockImplementation((e) => Promise.resolve(e));
      mockRedis.hgetall.mockResolvedValue({
        startedAt: new Date().toISOString(),
        totalSeconds: '3600',
        mcqSeconds: '1800',
        section: 'mcq',
      });

      const result = await service.startTest('user-1', 'test-1');

      expect(result.participation.currentSection).toBe('mcq');
      expect(result.participation.mcqSubmitted).toBe(false);
      expect(result.participation.codingUnlocked).toBe(false);
      expect(result.timer.remaining).toBeGreaterThan(0);
    });

    it('Step 2: Save MCQ answers → one correct, one wrong, one unanswered', async () => {
      const activeParticipation = { ...participation };
      participationsRepo.findOne.mockResolvedValue(activeParticipation);
      mcqResponsesRepo.findOne.mockResolvedValue(null);
      mcqResponsesRepo.create.mockImplementation((dto) => ({ id: 'r-new', ...dto }));
      mcqResponsesRepo.save.mockImplementation((e) => Promise.resolve(e));

      // Save answer for q1 (correct: 'a')
      questionsRepo.findOne.mockResolvedValue(questions[0]);
      const r1 = await service.saveMcqAnswer('user-1', 'test-1', 'q1', 'a');
      expect(r1.saved).toBe(true);

      // Save answer for q2 (wrong: 'a' instead of 'b')
      questionsRepo.findOne.mockResolvedValue(questions[1]);
      const r2 = await service.saveMcqAnswer('user-1', 'test-1', 'q2', 'a');
      expect(r2.saved).toBe(true);

      // q3 left unanswered
    });

    it('Step 2b: Reject invalid option ID', async () => {
      participationsRepo.findOne.mockResolvedValue(participation);
      questionsRepo.findOne.mockResolvedValue(questions[0]);

      await expect(
        service.saveMcqAnswer('user-1', 'test-1', 'q1', 'z'),
      ).rejects.toThrow('Invalid option');
    });

    it('Step 3: Submit MCQ → score calculated, coding unlocked if cutoff met', async () => {
      participationsRepo.findOne.mockResolvedValue(participation);
      testsRepo.findOne.mockResolvedValue(testEntity);
      questionsRepo.find.mockResolvedValue(questions);

      const savedResponses = [
        { id: 'r1', participationId: 'p-1', questionId: 'q1', selectedOption: 'a', isCorrect: false, marksAwarded: 0 },
        { id: 'r2', participationId: 'p-1', questionId: 'q2', selectedOption: 'a', isCorrect: false, marksAwarded: 0 },
      ];
      mcqResponsesRepo.find.mockResolvedValue(savedResponses);
      mcqResponsesRepo.save.mockImplementation((e) => Promise.resolve(e));
      participationsRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.submitMcqSection('user-1', 'test-1');

      // q1: correct (+10), q2: wrong (-1), q3: unanswered
      // Total raw: 9, floored: 9, percent: 9/30 = 30%
      expect(result.correct).toBe(1);
      expect(result.wrong).toBe(1);
      expect(result.unanswered).toBe(1);
      expect(result.mcqScore).toBe(9);
      expect(result.totalMcqMarks).toBe(30);
      // 9/30 = 30% < 50% cutoff
      expect(result.cutoffMet).toBe(false);
      expect(result.codingUnlocked).toBe(false);
    });

    it('Step 4: MCQ submitted → cannot save more answers', async () => {
      participationsRepo.findOne.mockResolvedValue({ ...participation, mcqSubmitted: true });

      await expect(
        service.saveMcqAnswer('user-1', 'test-1', 'q1', 'b'),
      ).rejects.toThrow('MCQ section already submitted');
    });

    it('Step 5: MCQ submitted → cannot submit again', async () => {
      participationsRepo.findOne.mockResolvedValue({ ...participation, mcqSubmitted: true });

      await expect(
        service.submitMcqSection('user-1', 'test-1'),
      ).rejects.toThrow('MCQ section already submitted');
    });

    it('Step 6: Coding locked when cutoff not met', async () => {
      participationsRepo.findOne.mockResolvedValue({
        ...participation,
        mcqSubmitted: true,
        codingUnlocked: false,
      });

      await expect(
        service.submitCoding('user-1', 'test-1', 'cq-1', 71, 'print("hi")'),
      ).rejects.toThrow('Coding section is locked');
    });

    it('Step 7: When all answers correct → cutoff met → coding unlocked', async () => {
      const freshParticipation = { ...participation, mcqSubmitted: false };
      participationsRepo.findOne.mockResolvedValue(freshParticipation);
      testsRepo.findOne.mockResolvedValue({ ...testEntity, mcqCutoffPercent: 50 });
      questionsRepo.find.mockResolvedValue(questions);

      const allCorrect = [
        { id: 'r1', participationId: 'p-1', questionId: 'q1', selectedOption: 'a', isCorrect: false, marksAwarded: 0 },
        { id: 'r2', participationId: 'p-1', questionId: 'q2', selectedOption: 'b', isCorrect: false, marksAwarded: 0 },
        { id: 'r3', participationId: 'p-1', questionId: 'q3', selectedOption: 'a', isCorrect: false, marksAwarded: 0 },
      ];
      mcqResponsesRepo.find.mockResolvedValue(allCorrect);
      mcqResponsesRepo.save.mockImplementation((e) => Promise.resolve(e));
      participationsRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.submitMcqSection('user-1', 'test-1');

      expect(result.mcqScore).toBe(30);
      expect(result.mcqPercent).toBe(100);
      expect(result.cutoffMet).toBe(true);
      expect(result.codingUnlocked).toBe(true);
    });
  });
});
