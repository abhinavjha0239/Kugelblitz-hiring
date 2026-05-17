import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ExamSet } from './exam-set.entity';
import { PaperQuestion } from '../paper/paper-question.entity';
import { Paper } from '../paper/paper.entity';
import { TestParticipation, ParticipationStatus } from '../results/test-participation.entity';
import { CreateSetDto, UpdateSetDto } from './dto/exam-set.dto';

@Injectable()
export class ExamSetService {
  private readonly logger = new Logger(ExamSetService.name);

  constructor(
    @InjectRepository(ExamSet)
    private readonly setsRepo: Repository<ExamSet>,
    @InjectRepository(PaperQuestion)
    private readonly paperQuestionsRepo: Repository<PaperQuestion>,
    @InjectRepository(Paper)
    private readonly papersRepo: Repository<Paper>,
    @InjectRepository(TestParticipation)
    private readonly participationsRepo: Repository<TestParticipation>,
  ) {}

  /**
   * Idempotent: ensures a default set exists for a test. Migrates any
   * paper_questions rows belonging to this test that have setId=NULL to
   * point to that default set.
   */
  async ensureDefaultSet(testId: string): Promise<ExamSet> {
    let def = await this.setsRepo.findOne({
      where: { testId, isDefault: true },
    });
    if (!def) {
      try {
        def = await this.setsRepo.save(
          this.setsRepo.create({
            testId,
            name: 'Set A',
            code: 'A',
            isActive: true,
            isDefault: true,
          }),
        );
        this.logger.log(`Created default Set A for test ${testId}`);
      } catch (err: any) {
        // Race: another concurrent ensureDefaultSet won the unique-key check.
        if (
          err?.code === 'ER_DUP_ENTRY' ||
          err?.code === '23505' ||
          String(err?.message || '').includes('Duplicate entry')
        ) {
          def = await this.setsRepo.findOne({ where: { testId, isDefault: true } });
          if (!def) throw err;
        } else {
          throw err;
        }
      }
    }
    // Migrate orphan paper_questions (setId NULL) for papers under this test —
    // single UPDATE instead of N saves. Idempotent; runs once per call but
    // affects 0 rows if there are no orphans.
    const papers = await this.papersRepo.find({ where: { examId: testId }, select: ['id'] });
    if (papers.length === 0) return def;
    const paperIds = papers.map((p) => p.id);
    const result = await this.paperQuestionsRepo
      .createQueryBuilder()
      .update()
      .set({ setId: def.id })
      .where('paper_id IN (:...paperIds)', { paperIds })
      .andWhere('set_id IS NULL')
      .execute();
    if ((result.affected ?? 0) > 0) {
      this.logger.log(
        `Migrated ${result.affected} legacy paper_questions to default set for test ${testId}`,
      );
    }
    return def;
  }

  async list(testId: string): Promise<ExamSet[]> {
    await this.ensureDefaultSet(testId);
    return this.setsRepo.find({
      where: { testId },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
  }

  async getById(setId: string): Promise<ExamSet> {
    const s = await this.setsRepo.findOne({ where: { id: setId } });
    if (!s) throw new NotFoundException('Set not found');
    return s;
  }

  async create(testId: string, dto: CreateSetDto): Promise<ExamSet> {
    await this.ensureDefaultSet(testId);
    const code = (dto.code || dto.name).slice(0, 32).toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    const exists = await this.setsRepo.findOne({ where: { testId, code } });
    if (exists) {
      throw new BadRequestException(`Set with code ${code} already exists`);
    }
    return this.setsRepo.save(
      this.setsRepo.create({
        testId,
        name: dto.name,
        code,
        isActive: dto.isActive ?? true,
        isDefault: false,
      }),
    );
  }

  async update(setId: string, dto: UpdateSetDto): Promise<ExamSet> {
    const s = await this.getById(setId);
    if (dto.name !== undefined) s.name = dto.name;
    if (dto.code !== undefined)
      s.code = dto.code.slice(0, 32).toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    if (dto.isActive !== undefined) s.isActive = dto.isActive;
    return this.setsRepo.save(s);
  }

  async remove(setId: string): Promise<{ removed: boolean }> {
    const s = await this.getById(setId);
    if (s.isDefault) {
      throw new BadRequestException('Cannot delete the default set');
    }
    // Block delete if any participation is pinned to this set (would orphan attempts)
    const pinnedCount = await this.participationsRepo.count({ where: { setId: s.id } });
    if (pinnedCount > 0) {
      throw new BadRequestException(
        `Cannot delete set: ${pinnedCount} candidate attempt(s) are pinned to it. Deactivate the set instead so no new candidates pick it up.`,
      );
    }
    await this.paperQuestionsRepo.delete({ setId: s.id });
    await this.setsRepo.delete({ id: s.id });
    return { removed: true };
  }

  /**
   * Returns sets that are active AND have at least one question mapped (across any paper).
   * Empty sets would give the candidate 0 questions and a stuck exam, so they're excluded
   * from auto-pick.
   */
  private async listAssignableSets(testId: string): Promise<ExamSet[]> {
    const allActive = await this.setsRepo.find({ where: { testId, isActive: true } });
    if (allActive.length === 0) return [];
    const setsWithQuestions = await this.paperQuestionsRepo
      .createQueryBuilder('pq')
      .innerJoin('papers', 'p', 'p.id = pq.paper_id')
      .where('p.exam_id = :testId', { testId })
      .andWhere('pq.set_id IN (:...setIds)', { setIds: allActive.map((s) => s.id) })
      .select('DISTINCT pq.set_id', 'setId')
      .getRawMany<{ setId: string }>();
    const ids = new Set(setsWithQuestions.map((r) => r.setId));
    return allActive.filter((s) => ids.has(s.id));
  }

  async pickRandomActive(testId: string): Promise<ExamSet | null> {
    const sets = await this.listAssignableSets(testId);
    if (sets.length === 0) return null;
    return sets[Math.floor(Math.random() * sets.length)];
  }

  /**
   * Round-robin pick from assignable sets (active + non-empty).
   */
  async pickRoundRobin(
    testId: string,
    countByTesterFn: (setId: string) => Promise<number>,
  ): Promise<ExamSet | null> {
    const sets = await this.listAssignableSets(testId);
    if (sets.length === 0) return null;
    const counts = await Promise.all(
      sets.map(async (s) => ({ set: s, n: await countByTesterFn(s.id) })),
    );
    counts.sort((a, b) => a.n - b.n);
    return counts[0].set;
  }
}
