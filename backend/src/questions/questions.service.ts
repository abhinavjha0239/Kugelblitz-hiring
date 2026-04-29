import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Question } from './question.entity';
import { TestCase } from './test-case.entity';
import { CreateQuestionDto, UpdateQuestionDto, CreateTestCaseDto } from './dto/create-question.dto';
import { TestsService } from '../tests/tests.service';

@Injectable()
export class QuestionsService {
  private readonly questionsByTestCacheTtlMs = 10_000;
  private readonly questionsByTestCache = new Map<string, { expiresAt: number; value: Question[] }>();

  constructor(
    @InjectRepository(Question)
    private questionsRepo: Repository<Question>,
    @InjectRepository(TestCase)
    private testCasesRepo: Repository<TestCase>,
    private testsService: TestsService,
  ) {}

  async create(dto: CreateQuestionDto): Promise<Question> {
    const { testCases, ...questionData } = dto;

    const question = this.questionsRepo.create(questionData);
    const saved = await this.questionsRepo.save(question);

    if (testCases && testCases.length > 0) {
      const cases = testCases.map((tc) =>
        this.testCasesRepo.create({ ...tc, questionId: saved.id }),
      );
      await this.testCasesRepo.save(cases);
    }

    await this.testsService.recalculateTotalMarks(dto.testId);
    this.invalidateQuestionsCache(dto.testId);

    return this.findById(saved.id);
  }

  async findByTestId(testId: string): Promise<Question[]> {
    const cached = this.questionsByTestCache.get(testId);
    if (cached && cached.expiresAt > Date.now()) {
      return this.deepClone(cached.value);
    }

    const questions = await this.questionsRepo.find({
      where: { testId },
      relations: ['testCases'],
      order: { orderIndex: 'ASC' },
    });
    this.questionsByTestCache.set(testId, {
      expiresAt: Date.now() + this.questionsByTestCacheTtlMs,
      value: questions,
    });
    return this.deepClone(questions);
  }

  async findById(id: string): Promise<Question> {
    const question = await this.questionsRepo.findOne({
      where: { id },
      relations: ['testCases'],
    });
    if (!question) throw new NotFoundException('Question not found');
    return question;
  }

  async update(id: string, dto: UpdateQuestionDto): Promise<Question> {
    const question = await this.findById(id);
    Object.assign(question, dto);
    const saved = await this.questionsRepo.save(question);
    await this.testsService.recalculateTotalMarks(question.testId);
    this.invalidateQuestionsCache(question.testId);
    return saved;
  }

  async remove(id: string): Promise<void> {
    const question = await this.findById(id);
    const testId = question.testId;
    await this.questionsRepo.remove(question);
    await this.testsService.recalculateTotalMarks(testId);
    this.invalidateQuestionsCache(testId);
  }

  async addTestCase(questionId: string, dto: CreateTestCaseDto): Promise<TestCase> {
    const question = await this.findById(questionId);
    const testCase = this.testCasesRepo.create({ ...dto, questionId });
    const saved = await this.testCasesRepo.save(testCase);
    this.invalidateQuestionsCache(question.testId);
    return saved;
  }

  async removeTestCase(testCaseId: string): Promise<void> {
    const tc = await this.testCasesRepo.findOne({
      where: { id: testCaseId },
      relations: ['question'],
    });
    if (!tc) throw new NotFoundException('Test case not found');
    await this.testCasesRepo.remove(tc);
    if (tc.question?.testId) {
      this.invalidateQuestionsCache(tc.question.testId);
    }
  }

  async getTestCasesForExecution(questionId: string): Promise<TestCase[]> {
    return this.testCasesRepo.find({ where: { questionId } });
  }

  private invalidateQuestionsCache(testId: string): void {
    this.questionsByTestCache.delete(testId);
  }

  private deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
