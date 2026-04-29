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
};

@Injectable()
export class PaperSessionCacheService {
  private readonly logger = new Logger(PaperSessionCacheService.name);
  private readonly redis: Redis;
  private readonly ttlSeconds = 60 * 60 * 12;

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
    const raw = await this.redis.get(this.paperSessionKey(userId, paperId));
    if (!raw) return null;
    return JSON.parse(raw) as PaperSessionCachePayload;
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
    const raw = await this.redis.get(this.paperAnswersKey(userId, paperId));
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
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

