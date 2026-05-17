import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Submission, SubmissionStatus } from './submission.entity';
import { CreateSubmissionDto, RunCodeDto } from './dto/create-submission.dto';
import { SubmissionProducer } from '../queue/submission.producer';
import { Judge0Service } from '../judge0/judge0.service';
import { UserRole } from '../users/user.entity';

@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);
  private lastSubmissionTime = new Map<string, number>();

  constructor(
    @InjectRepository(Submission)
    private submissionsRepo: Repository<Submission>,
    private submissionProducer: SubmissionProducer,
    private judge0Service: Judge0Service,
  ) {}

  async create(dto: CreateSubmissionDto, userId: string): Promise<Submission> {
    const now = Date.now();
    const lastTime = this.lastSubmissionTime.get(userId) || 0;
    if (now - lastTime < 3000) {
      throw new BadRequestException('Rate limit: please wait 3 seconds between submissions');
    }
    this.lastSubmissionTime.set(userId, now);

    const submission = this.submissionsRepo.create({
      ...dto,
      userId,
      status: SubmissionStatus.QUEUED,
    });
    const saved = await this.submissionsRepo.save(submission);

    await this.submissionProducer.addSubmissionJob({
      submissionId: saved.id,
      userId,
      questionId: dto.questionId,
      testId: dto.testId,
      sourceCode: dto.sourceCode,
      languageId: dto.languageId,
      isFinal: dto.isFinal || false,
    });

    return saved;
  }

  async runCode(dto: RunCodeDto): Promise<any> {
    return this.judge0Service.runCode(dto.sourceCode, dto.languageId, dto.stdin);
  }

  async findById(id: string, requesterId?: string, requesterRole?: string): Promise<Submission> {
    const submission = await this.submissionsRepo.findOne({
      where: { id },
      relations: ['user', 'question'],
    });
    if (!submission) throw new NotFoundException('Submission not found');
    // Ownership / role check: only the owner or an admin may read.
    if (requesterId && requesterRole !== UserRole.ADMIN && submission.userId !== requesterId) {
      throw new ForbiddenException('You do not have access to this submission');
    }
    return submission;
  }

  async findByUserAndTest(userId: string, testId: string): Promise<Submission[]> {
    return this.submissionsRepo.find({
      where: { userId, testId },
      relations: ['question'],
      order: { createdAt: 'DESC' },
    });
  }

  async findByUserAndQuestion(userId: string, questionId: string): Promise<Submission[]> {
    return this.submissionsRepo.find({
      where: { userId, questionId },
      order: { createdAt: 'DESC' },
      take: 10,
    });
  }

  async getLatestByUserAndQuestion(userId: string, questionId: string): Promise<Submission | null> {
    return this.submissionsRepo.findOne({
      where: { userId, questionId },
      order: { createdAt: 'DESC' },
    });
  }

  async findByTest(testId: string, page = 1, limit = 50): Promise<{ submissions: Submission[]; total: number }> {
    const [submissions, total] = await this.submissionsRepo.findAndCount({
      where: { testId },
      relations: ['user', 'question'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { submissions, total };
  }

  async autoSave(userId: string, questionId: string, testId: string, sourceCode: string, languageId: number): Promise<void> {
    const existing = await this.submissionsRepo.findOne({
      where: { userId, questionId, testId, isFinal: false },
      order: { createdAt: 'DESC' },
    });

    if (existing && existing.status === SubmissionStatus.QUEUED) {
      await this.submissionsRepo.update(existing.id, { sourceCode, languageId });
    }
  }
}
