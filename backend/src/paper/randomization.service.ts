import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'crypto';
import { Question } from '../questions/question.entity';

type RenderedQuestion = {
  id: string;
  title: string;
  description: string;
  marks: number;
  orderIndex: number;
  type: Question['type'];
  mcqOptions: { id: string; text: string }[] | null;
  testCases?: { id: string; input: string; expectedOutput: string; isHidden: boolean }[] | null;
};

@Injectable()
export class RandomizationService {
  private readonly optionSecret: string;

  constructor(private readonly config: ConfigService) {
    // Derive scrambling secret from env. Falls back to SEB_QUIT_PASSWORD_HASH so
    // existing deployments don't need a new env var, but OPTION_KEY_SECRET is
    // preferred for key separation. Never empty — a missing secret would produce a
    // constant scramble key across all students, defeating the purpose.
    this.optionSecret =
      this.config.get<string>('OPTION_KEY_SECRET') ||
      this.config.get<string>('SEB_QUIT_PASSWORD_HASH') ||
      (() => {
        throw new Error('Neither OPTION_KEY_SECRET nor SEB_QUIT_PASSWORD_HASH is set');
      })();
  }

  shuffleQuestionsByStudent(questions: Question[], studentId: string, paperId: string, takeCount: number): Question[] {
    const seed = this.seedFrom(`${studentId}:${paperId}`);
    const shuffled = this.seededShuffle([...questions], seed);
    return shuffled.slice(0, Math.min(takeCount, shuffled.length));
  }

  // Returns:
  //   rendered    — questions with SCRAMBLED per-student option IDs (no correct-answer field)
  //   answerKey   — server-side only: { questionId → realCorrectOptionId }
  //   optionIdMap — server-side only: { scrambledId → realOptionId } (for submission scoring)
  buildRenderedQuestions(
    questions: Question[],
    studentId: string,
  ): { rendered: RenderedQuestion[]; answerKey: Record<string, string | null>; optionIdMap: Record<string, string> } {
    const answerKey: Record<string, string | null> = {};
    const optionIdMap: Record<string, string> = {};

    const rendered = questions.map((question, idx) => {
      if (!question.mcqOptions || question.mcqOptions.length === 0) {
        answerKey[question.id] = question.mcqCorrectAnswer;
        return {
          id: question.id,
          title: question.title,
          description: question.description,
          marks: Number(question.marks),
          orderIndex: idx,
          type: question.type,
          mcqOptions: question.mcqOptions,
          testCases: question.testCases
            ? question.testCases.map((tc) => ({
                id: tc.id,
                input: tc.input,
                expectedOutput: tc.isHidden ? '' : tc.expectedOutput,
                isHidden: tc.isHidden,
              }))
            : null,
        };
      }

      const seed = this.seedFrom(`${studentId}:${question.id}`);
      const shuffledOptions = this.seededShuffle([...question.mcqOptions], seed);
      const correctOption = shuffledOptions.find((opt) => opt.id === question.mcqCorrectAnswer);
      answerKey[question.id] = correctOption ? correctOption.id : null;

      // Replace each option's real UUID with a per-student HMAC token.
      // This means option IDs discovered by one candidate are useless to another.
      const scrambledOptions = shuffledOptions.map((opt) => {
        const scrambled = this.scrambleOptionId(question.id, opt.id, studentId);
        optionIdMap[scrambled] = opt.id;
        return { id: scrambled, text: opt.text };
      });

      return {
        id: question.id,
        title: question.title,
        description: question.description,
        marks: Number(question.marks),
        orderIndex: idx,
        type: question.type,
        mcqOptions: scrambledOptions,
      };
    });

    return { rendered, answerKey, optionIdMap };
  }

  // HMAC-SHA256(secret, studentId:questionId:realOptionId) → first 16 hex chars.
  // Deterministic: same inputs always produce the same token, so cache regeneration
  // after TTL expiry produces identical scrambled IDs (submitted answers still resolve).
  // Student-specific: different studentIds produce different tokens for the same option,
  // so a discovered correct-option token from one candidate cannot be used by another.
  private scrambleOptionId(questionId: string, realOptionId: string, studentId: string): string {
    return createHmac('sha256', this.optionSecret)
      .update(`${studentId}:${questionId}:${realOptionId}`)
      .digest('hex')
      .slice(0, 16);
  }

  private seedFrom(value: string): number {
    const hash = createHash('sha256').update(value).digest('hex').slice(0, 8);
    return parseInt(hash, 16) >>> 0;
  }

  private seededShuffle<T>(arr: T[], seed: number): T[] {
    const rand = this.mulberry32(seed);
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  private mulberry32(seed: number): () => number {
    let t = seed >>> 0;
    return () => {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
}

