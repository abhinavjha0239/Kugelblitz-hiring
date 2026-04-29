import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TestSessionController } from './test-session.controller';
import { TestSessionService } from './test-session.service';

describe('TestSessionController', () => {
  let controller: TestSessionController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      startTest: jest.fn(),
      recordIpAddress: jest.fn(),
      getSessionStatus: jest.fn(),
      saveMcqAnswer: jest.fn(),
      submitMcqSection: jest.fn(),
      submitCoding: jest.fn(),
      finalSubmit: jest.fn(),
      getTimerState: jest.fn(),
      logAntiCheat: jest.fn(),
      trackQuestionTime: jest.fn(),
      getActiveUsers: jest.fn(),
      getViolations: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TestSessionController],
      providers: [{ provide: TestSessionService, useValue: service }],
    }).compile();

    controller = module.get<TestSessionController>(TestSessionController);
  });

  const mockReq = { ip: '127.0.0.1', headers: {} } as any;

  // ═══ startTest ════════════════════════════════════════════
  describe('startTest', () => {
    it('should delegate to service and record IP', async () => {
      const expected = { participation: { id: 'p-1' }, timer: { remaining: 3600 } };
      service.startTest.mockResolvedValue(expected);
      service.recordIpAddress.mockResolvedValue(undefined);

      const result = await controller.startTest('test-uuid', 'user-uuid', mockReq);

      expect(service.startTest).toHaveBeenCalledWith('user-uuid', 'test-uuid');
      expect(service.recordIpAddress).toHaveBeenCalledWith('user-uuid', 'test-uuid', '127.0.0.1');
      expect(result).toEqual(expected);
    });

    it('should propagate NotFoundException', async () => {
      service.startTest.mockRejectedValue(new NotFoundException('Test not found'));
      await expect(controller.startTest('bad-id', 'user-uuid', mockReq)).rejects.toThrow(NotFoundException);
    });
  });

  // ═══ getStatus ════════════════════════════════════════════
  describe('getStatus', () => {
    it('should return session status with MCQ questions and saved answers', async () => {
      const expected = {
        participation: { id: 'p-1', currentSection: 'mcq' },
        mcqQuestions: [{ id: 'q-1' }],
        codingQuestions: [],
        savedAnswers: { 'q-1': 'b' },
        timer: { remaining: 3500 },
      };
      service.getSessionStatus.mockResolvedValue(expected);

      const result = await controller.getStatus('test-uuid', 'user-uuid') as any;

      expect(service.getSessionStatus).toHaveBeenCalledWith('user-uuid', 'test-uuid');
      expect(result.savedAnswers['q-1']).toBe('b');
    });
  });

  // ═══ saveMcqAnswer ════════════════════════════════════════
  describe('saveMcqAnswer', () => {
    it('should pass DTO fields to service', async () => {
      service.saveMcqAnswer.mockResolvedValue({ questionId: 'q-1', selectedOption: 'c', saved: true });

      const result = await controller.saveMcqAnswer(
        { testId: 'test-1', questionId: 'q-1', selectedOption: 'c' },
        'user-1',
      );

      expect(service.saveMcqAnswer).toHaveBeenCalledWith('user-1', 'test-1', 'q-1', 'c');
      expect(result.saved).toBe(true);
    });

    it('should propagate BadRequestException', async () => {
      service.saveMcqAnswer.mockRejectedValue(new BadRequestException('MCQ section already submitted'));
      await expect(
        controller.saveMcqAnswer({ testId: 'test-1', questionId: 'q-1', selectedOption: 'c' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ═══ submitMcqSection ═════════════════════════════════════
  describe('submitMcqSection', () => {
    it('should return scoring results with cutoff evaluation', async () => {
      const expected = {
        mcqScore: 30,
        totalMcqMarks: 50,
        correct: 3,
        wrong: 1,
        unanswered: 1,
        cutoffMet: true,
        codingUnlocked: true,
      };
      service.submitMcqSection.mockResolvedValue(expected);

      const result = await controller.submitMcqSection({ testId: 'test-1' }, 'user-1');

      expect(service.submitMcqSection).toHaveBeenCalledWith('user-1', 'test-1');
      expect(result.cutoffMet).toBe(true);
    });
  });

  // ═══ submitCoding ═════════════════════════════════════════
  describe('submitCoding', () => {
    it('should delegate all DTO fields to service', async () => {
      service.submitCoding.mockResolvedValue({ id: 'sub-1', status: 'queued' });

      const dto = { testId: 'test-1', questionId: 'q-1', languageId: 71, sourceCode: 'print("hi")' };
      const result = await controller.submitCoding(dto, 'user-1');

      expect(service.submitCoding).toHaveBeenCalledWith('user-1', 'test-1', 'q-1', 71, 'print("hi")');
      expect(result.status).toBe('queued');
    });
  });

  // ═══ finalSubmit ══════════════════════════════════════════
  describe('finalSubmit', () => {
    it('should pass isAutoSubmit flag', async () => {
      service.finalSubmit.mockResolvedValue({ totalScore: 50 });
      await controller.finalSubmit({ testId: 'test-1', isAutoSubmit: true }, 'user-1');
      expect(service.finalSubmit).toHaveBeenCalledWith('user-1', 'test-1', true);
    });
  });

  // ═══ getTimer ═════════════════════════════════════════════
  describe('getTimer', () => {
    it('should return timer state', async () => {
      service.getTimerState.mockResolvedValue({ remaining: 1800, totalSeconds: 3600, section: 'mcq' });
      const result = await controller.getTimer('test-1', 'user-1');
      expect(result.remaining).toBe(1800);
    });
  });

  // ═══ trackQuestionTime ════════════════════════════════════
  describe('trackQuestionTime', () => {
    it('should forward time tracking to service', async () => {
      service.trackQuestionTime.mockResolvedValue({ questionId: 'q-1', totalTime: 45 });
      const result = await controller.trackQuestionTime(
        { testId: 'test-1', questionId: 'q-1', timeSpentSeconds: 15 },
        'user-1',
      );
      expect(service.trackQuestionTime).toHaveBeenCalledWith('user-1', 'test-1', 'q-1', 15);
      expect(result.totalTime).toBe(45);
    });
  });

  // ═══ Admin endpoints ══════════════════════════════════════
  describe('admin/active-users', () => {
    it('should return active users for a test', async () => {
      service.getActiveUsers.mockResolvedValue({ count: 2, users: [{}, {}] });
      const result = await controller.getActiveUsers('test-1');
      expect(service.getActiveUsers).toHaveBeenCalledWith('test-1');
      expect(result.count).toBe(2);
    });
  });

  describe('admin/violations', () => {
    it('should return violation logs', async () => {
      service.getViolations.mockResolvedValue({ count: 3, violations: [{}, {}, {}] });
      const result = await controller.getViolations('test-1');
      expect(service.getViolations).toHaveBeenCalledWith('test-1');
      expect(result.count).toBe(3);
    });
  });

  // ═══ logAntiCheat ═════════════════════════════════════════
  describe('logAntiCheat', () => {
    it('should forward with IP address', async () => {
      service.logAntiCheat.mockResolvedValue(undefined);
      await controller.logAntiCheat({ testId: 'test-1', type: 'tab_switch' }, 'user-1', mockReq);
      expect(service.logAntiCheat).toHaveBeenCalledWith('user-1', 'test-1', 'tab_switch', '127.0.0.1');
    });
  });
});
