import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Paper } from './paper.entity';
import { PaperQuestion } from './paper-question.entity';
import { StudentPaperSession } from './student-paper-session.entity';
import { Question } from '../questions/question.entity';
import { CreatePaperDto, SetPaperQuestionsDto, UpdatePaperDto } from './dto/paper-admin.dto';
import { ExamSetService } from '../exam-set/exam-set.service';

@Injectable()
export class PaperService {
  constructor(
    @InjectRepository(Paper)
    private readonly papersRepo: Repository<Paper>,
    @InjectRepository(PaperQuestion)
    private readonly paperQuestionsRepo: Repository<PaperQuestion>,
    @InjectRepository(StudentPaperSession)
    private readonly studentPaperSessionsRepo: Repository<StudentPaperSession>,
    @InjectRepository(Question)
    private readonly questionsRepo: Repository<Question>,
    @Inject(forwardRef(() => ExamSetService))
    private readonly examSetService: ExamSetService,
  ) {}

  private async resolveSetId(testId: string, setId?: string | null): Promise<string> {
    if (setId) return setId;
    const def = await this.examSetService.ensureDefaultSet(testId);
    return def.id;
  }

  async createPaper(dto: CreatePaperDto): Promise<Paper> {
    const paper = this.papersRepo.create({
      examId: dto.examId,
      name: dto.name,
      order: dto.order,
      totalQuestions: dto.totalQuestions,
      durationMinutes: dto.durationMinutes,
      passRequired: dto.passRequired ?? (dto.cutoffType && dto.cutoffType !== 'none') ?? false,
      cutoffType: dto.cutoffType ?? 'none',
      cutoffValue: dto.cutoffValue ?? 0,
      cutoffFailBehavior: dto.cutoffFailBehavior ?? 'lock_next',
    });
    return this.papersRepo.save(paper);
  }

  async updatePaper(paperId: string, dto: UpdatePaperDto): Promise<Paper> {
    const paper = await this.papersRepo.findOne({ where: { id: paperId } });
    if (!paper) throw new NotFoundException('Paper not found');
    Object.assign(paper, dto);
    if (dto.cutoffType !== undefined) {
      paper.passRequired = dto.cutoffType !== 'none';
    }
    return this.papersRepo.save(paper);
  }

  evaluateCutoff(paper: Paper, score: number, totalMarksOverride?: number): boolean {
    if (paper.cutoffType === 'none') return true;
    if (paper.cutoffType === 'percent') {
      const total = Number(totalMarksOverride ?? paper.totalMarks) || 0;
      if (total <= 0) return true;
      const pct = (score / total) * 100;
      return pct >= Number(paper.cutoffValue);
    }
    return score >= Number(paper.cutoffValue);
  }

  computeCarryOverDuration(
    timerMode: 'overall' | 'per_paper',
    timeCarryOver: boolean,
    prevSession: StudentPaperSession | null,
    nextPaperDurationMinutes: number,
  ): number {
    if (timerMode === 'overall') return nextPaperDurationMinutes;
    if (!timeCarryOver || !prevSession || !prevSession.startedAt || !prevSession.submittedAt) {
      return nextPaperDurationMinutes;
    }
    const usedMs = prevSession.submittedAt.getTime() - prevSession.startedAt.getTime();
    const usedMin = usedMs / 60_000;
    const baseMin = prevSession.paper?.durationMinutes ?? 0;
    const leftover = Math.max(0, baseMin - usedMin);
    return nextPaperDurationMinutes + leftover;
  }

  async recomputePaperTotalMarks(paperId: string, setId?: string): Promise<number> {
    const paper = await this.papersRepo.findOne({ where: { id: paperId } });
    if (!paper) return 0;
    const resolvedSetId = await this.resolveSetId(paper.examId, setId);
    const links = await this.paperQuestionsRepo.find({
      where: { paperId, setId: resolvedSetId },
      relations: ['question'],
    });
    const total = links.reduce((s, l) => s + Number(l.question?.marks ?? 0), 0);
    // Mirror the default set's total to paper.totalMarks for legacy/UI display.
    const def = await this.examSetService.ensureDefaultSet(paper.examId);
    if (def.id === resolvedSetId) {
      await this.papersRepo.update({ id: paperId }, { totalMarks: total });
    }
    return total;
  }

  async getPaperTotalMarksForSet(paperId: string, setId: string): Promise<number> {
    const links = await this.paperQuestionsRepo.find({
      where: { paperId, setId },
      relations: ['question'],
    });
    return links.reduce((s, l) => s + Number(l.question?.marks ?? 0), 0);
  }

  async deletePaper(paperId: string): Promise<void> {
    const paper = await this.papersRepo.findOne({ where: { id: paperId } });
    if (!paper) throw new NotFoundException('Paper not found');
    await this.papersRepo.remove(paper);
  }

  async setPaperQuestions(
    paperId: string,
    dto: SetPaperQuestionsDto,
    setId?: string,
  ): Promise<{ mapped: number }> {
    const paper = await this.papersRepo.findOne({ where: { id: paperId } });
    if (!paper) throw new NotFoundException('Paper not found');
    const resolvedSetId = await this.resolveSetId(paper.examId, setId);

    const questions = await this.questionsRepo.find({
      where: dto.questionIds.map((id) => ({ id, testId: paper.examId })),
      select: ['id'],
    });
    if (questions.length !== dto.questionIds.length) {
      throw new BadRequestException('One or more questionIds do not belong to this exam');
    }

    await this.paperQuestionsRepo.delete({ paperId, setId: resolvedSetId });
    const rows = dto.questionIds.map((questionId, idx) =>
      this.paperQuestionsRepo.create({ paperId, questionId, setId: resolvedSetId, sortOrder: idx }),
    );
    await this.paperQuestionsRepo.save(rows);
    await this.recomputePaperTotalMarks(paperId, resolvedSetId);
    return { mapped: rows.length };
  }

  async listExamPapers(examId: string): Promise<Paper[]> {
    return this.papersRepo.find({
      where: { examId },
      order: { order: 'ASC' },
      relations: ['questionLinks'],
    });
  }

  async getPaperById(paperId: string): Promise<Paper> {
    const paper = await this.papersRepo.findOne({
      where: { id: paperId },
      relations: ['questionLinks'],
    });
    if (!paper) throw new NotFoundException('Paper not found');
    return paper;
  }

  async getPaperQuestions(paperId: string, setId?: string): Promise<Question[]> {
    const paper = await this.papersRepo.findOne({ where: { id: paperId } });
    if (!paper) throw new NotFoundException('Paper not found');
    const resolvedSetId = await this.resolveSetId(paper.examId, setId);
    const links = await this.paperQuestionsRepo.find({
      where: { paperId, setId: resolvedSetId },
      relations: ['question', 'question.testCases'],
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return links
      .map((link) => link.question)
      .filter(Boolean);
  }

  async reorderPaperQuestions(
    paperId: string,
    questionIds: string[],
    setId?: string,
  ): Promise<{ reordered: number }> {
    const paper = await this.papersRepo.findOne({ where: { id: paperId } });
    if (!paper) throw new NotFoundException('Paper not found');
    const resolvedSetId = await this.resolveSetId(paper.examId, setId);
    const existing = await this.paperQuestionsRepo.find({
      where: { paperId, setId: resolvedSetId },
    });
    const byQid = new Map(existing.map((l) => [l.questionId, l]));
    let i = 0;
    for (const qid of questionIds) {
      const link = byQid.get(qid);
      if (link) {
        link.sortOrder = i++;
        await this.paperQuestionsRepo.save(link);
      }
    }
    return { reordered: i };
  }

  async bulkAddQuestionsToPaper(
    paperId: string,
    questionIds: string[],
    setId?: string,
  ): Promise<{ added: number; skipped: number }> {
    if (questionIds.length === 0) return { added: 0, skipped: 0 };
    const paper = await this.papersRepo.findOne({ where: { id: paperId } });
    if (!paper) throw new NotFoundException('Paper not found');
    const resolvedSetId = await this.resolveSetId(paper.examId, setId);
    return this.addQuestionsToPaperBatchInternal(paper, resolvedSetId, questionIds);
  }

  async autoAssignBySection(
    testId: string,
    setId?: string,
  ): Promise<{ assigned: Record<string, number> }> {
    const resolvedSetId = await this.resolveSetId(testId, setId);
    const allPapers = await this.papersRepo.find({
      where: { examId: testId },
      order: { order: 'ASC' },
    });
    const allQuestions = await this.questionsRepo.find({
      where: { testId },
      select: ['id', 'section'],
    });
    const assigned: Record<string, number> = {};
    // Group questions by their target paper (paper.order === question.section).
    const byPaper = new Map<string, string[]>();
    for (const q of allQuestions) {
      const targetPaper = allPapers.find((p) => p.order === q.section);
      if (!targetPaper) continue;
      const list = byPaper.get(targetPaper.id) ?? [];
      list.push(q.id);
      byPaper.set(targetPaper.id, list);
    }
    // Single batch call per target paper instead of per-question add.
    for (const [paperId, qids] of byPaper.entries()) {
      const paper = allPapers.find((p) => p.id === paperId)!;
      const r = await this.addQuestionsToPaperBatchInternal(paper, resolvedSetId, qids);
      if (r.added > 0) assigned[paperId] = r.added;
    }
    return { assigned };
  }

  /**
   * Batch-insert N questions into a paper for a given set in a constant number
   * of queries (not N per question). Skips already-mapped questions; moves
   * questions that are mapped to a different paper of the same exam in the same set.
   */
  private async addQuestionsToPaperBatchInternal(
    paper: Paper,
    setId: string,
    questionIds: string[],
  ): Promise<{ added: number; skipped: number }> {
    if (questionIds.length === 0) return { added: 0, skipped: 0 };
    const dedupedIds = Array.from(new Set(questionIds));

    // Validate all questions belong to this exam in one query.
    const validQuestions = await this.questionsRepo.find({
      where: { testId: paper.examId },
      select: ['id'],
    });
    const validIdSet = new Set(validQuestions.map((q) => q.id));
    const examQuestionIds = dedupedIds.filter((id) => validIdSet.has(id));
    let skipped = dedupedIds.length - examQuestionIds.length;

    if (examQuestionIds.length === 0) return { added: 0, skipped };

    // One query for all existing PaperQuestion rows in this set across all
    // papers of this exam. Lets us detect already-mapped + cross-paper moves.
    const allPapers = await this.papersRepo.find({ where: { examId: paper.examId }, select: ['id'] });
    const allPaperIds = allPapers.map((p) => p.id);
    const existing = await this.paperQuestionsRepo
      .createQueryBuilder('pq')
      .where('pq.paper_id IN (:...paperIds)', { paperIds: allPaperIds })
      .andWhere('pq.set_id = :setId', { setId })
      .andWhere('pq.question_id IN (:...qids)', { qids: examQuestionIds })
      .getMany();
    const existingByQid = new Map(existing.map((e) => [e.questionId, e]));

    const idsToCreate: string[] = [];
    const idsToMove: typeof existing = [];
    for (const qid of examQuestionIds) {
      const cur = existingByQid.get(qid);
      if (!cur) {
        idsToCreate.push(qid);
      } else if (cur.paperId === paper.id) {
        skipped++; // already in this paper for this set
      } else {
        idsToMove.push(cur);
      }
    }

    // Move-by-update: change paper_id for cross-paper rows in one statement.
    const movedFromPapers = new Set<string>();
    if (idsToMove.length > 0) {
      for (const m of idsToMove) movedFromPapers.add(m.paperId);
      await this.paperQuestionsRepo
        .createQueryBuilder()
        .update()
        .set({ paperId: paper.id })
        .whereInIds(idsToMove.map((m) => m.id))
        .execute();
    }

    // Insert brand-new rows in one batch.
    if (idsToCreate.length > 0) {
      await this.paperQuestionsRepo.save(
        idsToCreate.map((qid) =>
          this.paperQuestionsRepo.create({ paperId: paper.id, questionId: qid, setId }),
        ),
      );
    }

    // Recompute totalMarks ONCE per affected paper (target + any source papers).
    await this.recomputePaperTotalMarks(paper.id, setId);
    for (const fromPaperId of movedFromPapers) {
      await this.recomputePaperTotalMarks(fromPaperId, setId);
    }

    return { added: idsToCreate.length + idsToMove.length, skipped };
  }

  async getQuestionMapping(testId: string, setId?: string): Promise<{
    questions: Array<{
      id: string;
      title: string;
      type: string;
      marks: number;
      orderIndex: number;
      paperId: string | null;
    }>;
    papers: Array<{ id: string; name: string; order: number; totalMarks: number; mappedCount: number }>;
    setId: string;
  }> {
    const resolvedSetId = await this.resolveSetId(testId, setId);
    const allQuestions = await this.questionsRepo.find({
      where: { testId },
      order: { orderIndex: 'ASC' },
      select: ['id', 'title', 'type', 'marks', 'orderIndex'],
    });
    const allPapers = await this.papersRepo.find({
      where: { examId: testId },
      order: { order: 'ASC' },
    });
    const paperIds = allPapers.map((p) => p.id);
    const links = paperIds.length
      ? await this.paperQuestionsRepo
          .createQueryBuilder('pq')
          .where('pq.paper_id IN (:...paperIds)', { paperIds })
          .andWhere('pq.set_id = :setId', { setId: resolvedSetId })
          .getMany()
      : [];
    const questionToPaper = new Map<string, string>();
    const paperCounts = new Map<string, number>();
    const paperMarks = new Map<string, number>();
    for (const l of links) {
      questionToPaper.set(l.questionId, l.paperId);
      paperCounts.set(l.paperId, (paperCounts.get(l.paperId) || 0) + 1);
    }
    // Compute per-paper totalMarks for the requested set
    if (paperIds.length) {
      const detailLinks = await this.paperQuestionsRepo.find({
        where: { setId: resolvedSetId },
        relations: ['question'],
      });
      for (const l of detailLinks) {
        if (paperIds.includes(l.paperId)) {
          paperMarks.set(
            l.paperId,
            (paperMarks.get(l.paperId) || 0) + Number(l.question?.marks ?? 0),
          );
        }
      }
    }
    return {
      questions: allQuestions.map((q) => ({
        id: q.id,
        title: q.title,
        type: q.type,
        marks: Number(q.marks),
        orderIndex: q.orderIndex,
        paperId: questionToPaper.get(q.id) || null,
      })),
      papers: allPapers.map((p) => ({
        id: p.id,
        name: p.name,
        order: p.order,
        totalMarks: paperMarks.get(p.id) || 0,
        mappedCount: paperCounts.get(p.id) || 0,
      })),
      setId: resolvedSetId,
    };
  }

  async addQuestionToPaper(
    paperId: string,
    questionId: string,
    setId?: string,
  ): Promise<{ added: boolean }> {
    const paper = await this.papersRepo.findOne({ where: { id: paperId } });
    if (!paper) throw new NotFoundException('Paper not found');
    const question = await this.questionsRepo.findOne({ where: { id: questionId } });
    if (!question) throw new NotFoundException('Question not found');
    if (question.testId !== paper.examId) {
      throw new BadRequestException('Question does not belong to this exam');
    }
    const resolvedSetId = await this.resolveSetId(paper.examId, setId);
    // Within this set: remove the question from any other paper of the same exam (one-paper-per-question per set)
    const otherLinks = await this.paperQuestionsRepo
      .createQueryBuilder('pq')
      .innerJoin('papers', 'p', 'p.id = pq.paper_id')
      .where('p.exam_id = :examId', { examId: paper.examId })
      .andWhere('pq.question_id = :qid', { qid: questionId })
      .andWhere('pq.set_id = :setId', { setId: resolvedSetId })
      .getMany();
    for (const l of otherLinks) {
      if (l.paperId !== paperId) {
        await this.paperQuestionsRepo.delete({ id: l.id });
        await this.recomputePaperTotalMarks(l.paperId, resolvedSetId);
      }
    }
    const existing = await this.paperQuestionsRepo.findOne({
      where: { paperId, questionId, setId: resolvedSetId },
    });
    if (existing) return { added: false };
    await this.paperQuestionsRepo.save(
      this.paperQuestionsRepo.create({ paperId, questionId, setId: resolvedSetId }),
    );
    await this.recomputePaperTotalMarks(paperId, resolvedSetId);
    return { added: true };
  }

  async removeQuestionFromPaper(
    paperId: string,
    questionId: string,
    setId?: string,
  ): Promise<{ removed: boolean }> {
    const paper = await this.papersRepo.findOne({ where: { id: paperId } });
    if (!paper) throw new NotFoundException('Paper not found');
    const resolvedSetId = await this.resolveSetId(paper.examId, setId);
    const result = await this.paperQuestionsRepo.delete({
      paperId,
      questionId,
      setId: resolvedSetId,
    });
    const removed = (result.affected ?? 0) > 0;
    if (removed) await this.recomputePaperTotalMarks(paperId, resolvedSetId);
    return { removed };
  }

  async ensurePaperSessionsForSession(sessionId: string, papers: Paper[]): Promise<StudentPaperSession[]> {
    const existing = await this.studentPaperSessionsRepo.find({
      where: { sessionId },
      relations: ['paper'],
    });
    const existingPaperIds = new Set(existing.map((e) => e.paperId));
    const missing = papers
      .filter((paper) => !existingPaperIds.has(paper.id))
      .map((paper) => ({ sessionId, paperId: paper.id }));

    if (missing.length > 0) {
      // Concurrent startExam calls (StrictMode double-mount, Resume button race,
      // duplicate magic-link clicks) can have BOTH paths reach this point with
      // identical "missing" sets. The unique (sessionId, paperId) index causes
      // either a Duplicate-Entry error or — worse — an InnoDB row-lock deadlock
      // when the two transactions grab gap locks in different orders.
      //
      // INSERT IGNORE makes this idempotent: dup rows silently no-op, no lock fight.
      // We also retry once on deadlock as belt-and-braces because gap-lock deadlocks
      // can happen even with IGNORE under InnoDB's default isolation.
      const isLockOrDup = (err: any) => {
        const code = err?.code || '';
        const msg = String(err?.message || '');
        return (
          code === 'ER_LOCK_DEADLOCK' ||
          code === 'ER_LOCK_WAIT_TIMEOUT' ||
          code === 'ER_DUP_ENTRY' ||
          msg.includes('Deadlock') ||
          msg.includes('Lock wait timeout') ||
          msg.includes('Duplicate entry')
        );
      };
      let attempts = 3;
      while (attempts-- > 0) {
        try {
          await this.studentPaperSessionsRepo
            .createQueryBuilder()
            .insert()
            .into(StudentPaperSession)
            .values(missing)
            .orIgnore()
            .execute();
          break;
        } catch (err: any) {
          if (!isLockOrDup(err) || attempts === 0) throw err;
          await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
        }
      }
    }

    return this.studentPaperSessionsRepo.find({
      where: { sessionId },
      relations: ['paper'],
      order: { paper: { order: 'ASC' } },
    });
  }

  async getStudentPaperSessions(sessionId: string): Promise<StudentPaperSession[]> {
    return this.studentPaperSessionsRepo.find({
      where: { sessionId },
      relations: ['paper'],
      order: { paper: { order: 'ASC' } },
    });
  }
}

