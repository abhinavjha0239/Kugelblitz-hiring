import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

type PaperSessionCachePayload = {
  paperSessionId: string;
  testId: string;
  paperId: string;
  userId: string;
  generatedAt: string;
  questions: Array<{
    id: string;
    title: string;
    description: string;
    marks: number;
    orderIndex: number;
    type: string;
    mcqOptions: { id: string; text: string }[] | null;
  }>;
  answerKey: Record<string, string | null>;
  // Maps per-student scrambled option IDs back to real option IDs for scoring.
  // Present for sessions created after the option-scrambling feature was deployed;
  // absent for legacy sessions (submitPaper falls back to literal comparison).
  optionIdMap?: Record<string, string>;
};

@Injectable()
export class PaperSessionCacheService {
  private readonly logger = new Logger(PaperSessionCacheService.name);
  private readonly redis: Redis;
  // 24h covers long exam windows + reconnects without losing the seeded question order.
  private readonly ttlSeconds = 60 * 60 * 24;

  constructor(private readonly configService: ConfigService) {
    this.redis = new Redis({
      host: this.configService.get('redis.host'),
      port: this.configService.get('redis.port'),
      password: this.configService.get('redis.password') || undefined,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    this.redis.connect().catch((err) => this.logger.error('Redis connection failed', err.message));
  }

  async getPaperSession(userId: string, paperId: string): Promise<PaperSessionCachePayload | null> {
    const key = this.paperSessionKey(userId, paperId);
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PaperSessionCachePayload;
    } catch (err: any) {
      this.logger.warn(`Cache miss (parse error) ${key}: ${err.message}`);
      await this.redis.del(key);
      return null;
    }
  }

  async setPaperSession(payload: PaperSessionCachePayload): Promise<void> {
    await this.redis.set(
      this.paperSessionKey(payload.userId, payload.paperId),
      JSON.stringify(payload),
      'EX',
      this.ttlSeconds,
    );
  }

  async getAutosavedAnswers(userId: string, paperId: string): Promise<Record<string, string>> {
    const key = this.paperAnswersKey(userId, paperId);
    const raw = await this.redis.get(key);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch (err: any) {
      this.logger.warn(`Cache miss (parse error) ${key}: ${err.message}`);
      await this.redis.del(key);
      return {};
    }
  }

  async setAutosavedAnswers(userId: string, paperId: string, answers: Record<string, string>): Promise<void> {
    await this.redis.set(
      this.paperAnswersKey(userId, paperId),
      JSON.stringify(answers),
      'EX',
      this.ttlSeconds,
    );
  }

  private paperSessionKey(userId: string, paperId: string): string {
    return `paper_session:${userId}:${paperId}`;
  }

  private paperAnswersKey(userId: string, paperId: string): string {
    return `paper_answers:${userId}:${paperId}`;
  }
}

