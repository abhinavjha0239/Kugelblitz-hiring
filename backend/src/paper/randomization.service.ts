import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Question } from '../questions/question.entity';

type RenderedQuestion = {
  id: string;
  title: string;
  description: string;
  marks: number;
  orderIndex: number;
  type: Question['type'];
  mcqOptions: { id: string; text: string }[] | null;
};

@Injectable()
export class RandomizationService {
  shuffleQuestionsByStudent(questions: Question[], studentId: string, paperId: string, takeCount: number): Question[] {
    const seed = this.seedFrom(`${studentId}:${paperId}`);
    const shuffled = this.seededShuffle([...questions], seed);
    return shuffled.slice(0, Math.min(takeCount, shuffled.length));
  }

  buildRenderedQuestions(
    questions: Question[],
    studentId: string,
  ): { rendered: RenderedQuestion[]; answerKey: Record<string, string | null> } {
    const answerKey: Record<string, string | null> = {};
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
        };
      }

      const seed = this.seedFrom(`${studentId}:${question.id}`);
      const shuffledOptions = this.seededShuffle([...question.mcqOptions], seed);
      const correctOption = shuffledOptions.find((opt) => opt.id === question.mcqCorrectAnswer);
      answerKey[question.id] = correctOption ? correctOption.id : null;

      return {
        id: question.id,
        title: question.title,
        description: question.description,
        marks: Number(question.marks),
        orderIndex: idx,
        type: question.type,
        mcqOptions: shuffledOptions,
      };
    });

    return { rendered, answerKey };
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

