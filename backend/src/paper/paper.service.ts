import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Paper } from './paper.entity';
import { PaperQuestion } from './paper-question.entity';
import { StudentPaperSession } from './student-paper-session.entity';
import { Question } from '../questions/question.entity';
import { CreatePaperDto, SetPaperQuestionsDto, UpdatePaperDto } from './dto/paper-admin.dto';

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
  ) {}

  async createPaper(dto: CreatePaperDto): Promise<Paper> {
    const paper = this.papersRepo.create({
      examId: dto.examId,
      name: dto.name,
      order: dto.order,
      totalQuestions: dto.totalQuestions,
      durationMinutes: dto.durationMinutes,
      passRequired: dto.passRequired ?? false,
    });
    return this.papersRepo.save(paper);
  }

  async updatePaper(paperId: string, dto: UpdatePaperDto): Promise<Paper> {
    const paper = await this.papersRepo.findOne({ where: { id: paperId } });
    if (!paper) throw new NotFoundException('Paper not found');
    Object.assign(paper, dto);
    return this.papersRepo.save(paper);
  }

  async deletePaper(paperId: string): Promise<void> {
    const paper = await this.papersRepo.findOne({ where: { id: paperId } });
    if (!paper) throw new NotFoundException('Paper not found');
    await this.papersRepo.remove(paper);
  }

  async setPaperQuestions(paperId: string, dto: SetPaperQuestionsDto): Promise<{ mapped: number }> {
    const paper = await this.papersRepo.findOne({ where: { id: paperId } });
    if (!paper) throw new NotFoundException('Paper not found');

    const questions = await this.questionsRepo.find({
      where: dto.questionIds.map((id) => ({ id, testId: paper.examId })),
      select: ['id'],
    });
    if (questions.length !== dto.questionIds.length) {
      throw new BadRequestException('One or more questionIds do not belong to this exam');
    }

    await this.paperQuestionsRepo.delete({ paperId });
    const rows = dto.questionIds.map((questionId) => this.paperQuestionsRepo.create({ paperId, questionId }));
    await this.paperQuestionsRepo.save(rows);
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

  async getPaperQuestions(paperId: string): Promise<Question[]> {
    const links = await this.paperQuestionsRepo.find({
      where: { paperId },
      relations: ['question', 'question.testCases'],
    });
    return links
      .map((link) => link.question)
      .filter(Boolean);
  }

  async ensurePaperSessionsForSession(sessionId: string, papers: Paper[]): Promise<StudentPaperSession[]> {
    const existing = await this.studentPaperSessionsRepo.find({
      where: { sessionId },
      relations: ['paper'],
    });
    const existingPaperIds = new Set(existing.map((e) => e.paperId));
    const missing = papers
      .filter((paper) => !existingPaperIds.has(paper.id))
      .map((paper) =>
        this.studentPaperSessionsRepo.create({
          sessionId,
          paperId: paper.id,
        }),
      );
    if (missing.length > 0) {
      await this.studentPaperSessionsRepo.save(missing);
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

