import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Test } from './test.entity';
import { CreateTestDto, UpdateTestDto } from './dto/create-test.dto';

@Injectable()
export class TestsService {
  private readonly activeTestsCacheTtlMs = 15_000;
  private readonly testDetailCacheTtlMs = 10_000;
  private activeTestsCache: { expiresAt: number; value: Test[] } | null = null;
  private readonly testDetailCache = new Map<string, { expiresAt: number; value: Test }>();

  constructor(
    @InjectRepository(Test)
    private testsRepo: Repository<Test>,
  ) {}

  async create(dto: CreateTestDto, userId: string): Promise<Test> {
    const test = this.testsRepo.create({
      ...dto,
      createdById: userId,
    });
    const saved = await this.testsRepo.save(test);
    this.invalidateTestCaches(saved.id);
    return saved;
  }

  async findAll(page = 1, limit = 20): Promise<{ tests: Test[]; total: number }> {
    const [tests, total] = await this.testsRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
      relations: ['createdBy'],
      select: {
        createdBy: { id: true, firstName: true, lastName: true },
      },
    });
    return { tests, total };
  }

  async findActiveTests(): Promise<Test[]> {
    const nowTs = Date.now();
    if (this.activeTestsCache && this.activeTestsCache.expiresAt > nowTs) {
      return this.deepClone(this.activeTestsCache.value);
    }

    const now = new Date();
    const tests = await this.testsRepo
      .createQueryBuilder('test')
      .where('test.is_active = :active', { active: true })
      .andWhere('(test.starts_at IS NULL OR test.starts_at <= :now)', { now })
      .andWhere('(test.ends_at IS NULL OR test.ends_at >= :now)', { now })
      .orderBy('test.created_at', 'DESC')
      .getMany();

    this.activeTestsCache = {
      expiresAt: nowTs + this.activeTestsCacheTtlMs,
      value: tests,
    };
    return this.deepClone(tests);
  }

  async findById(id: string): Promise<Test> {
    const cached = this.testDetailCache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      return this.deepClone(cached.value);
    }

    const test = await this.testsRepo.findOne({
      where: { id },
      relations: ['questions', 'questions.testCases'],
    });
    if (!test) throw new NotFoundException('Test not found');
    this.testDetailCache.set(id, {
      expiresAt: Date.now() + this.testDetailCacheTtlMs,
      value: test,
    });
    return this.deepClone(test);
  }

  async findByIdForStudent(id: string): Promise<Test> {
    const test = await this.testsRepo.findOne({
      where: { id, isActive: true },
      relations: ['questions', 'questions.testCases'],
    });
    if (!test) throw new NotFoundException('Test not found or inactive');

    // Hide hidden test cases and correct MCQ answers
    test.questions = test.questions.map((q) => ({
      ...q,
      mcqCorrectAnswer: null,
      testCases: q.testCases.filter((tc) => !tc.isHidden),
    })) as any;

    return test;
  }

  async update(id: string, dto: UpdateTestDto): Promise<Test> {
    const test = await this.findById(id);
    Object.assign(test, dto);
    const saved = await this.testsRepo.save(test);
    this.invalidateTestCaches(id);
    return saved;
  }

  async remove(id: string): Promise<void> {
    const test = await this.findById(id);
    await this.testsRepo.remove(test);
    this.invalidateTestCaches(id);
  }

  async recalculateTotalMarks(testId: string): Promise<void> {
    const result = await this.testsRepo
      .createQueryBuilder('test')
      .leftJoin('test.questions', 'question')
      .select('COALESCE(SUM(question.marks), 0)', 'total')
      .where('test.id = :testId', { testId })
      .getRawOne();

    await this.testsRepo.update(testId, { totalMarks: Math.round(Number(result.total)) });
    this.invalidateTestCaches(testId);
  }

  private invalidateTestCaches(testId?: string): void {
    this.activeTestsCache = null;
    if (testId) {
      this.testDetailCache.delete(testId);
    } else {
      this.testDetailCache.clear();
    }
  }

  private deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
