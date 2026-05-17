import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { MagicLink, MagicLinkStatus } from './magic-link.entity';
import { Test } from '../tests/test.entity';
import { User, UserRole } from '../users/user.entity';
import { TestParticipation, ParticipationStatus } from '../results/test-participation.entity';
import { MailService } from '../mail/mail.service';
import { InviteRowDto, CompleteProfileDto } from './dto/magic-link.dto';
import { ExamSetService } from '../exam-set/exam-set.service';

export interface MagicLinkValidation {
  user: User;
  test: Test;
  link: MagicLink;
  profileComplete: boolean;
  accessToken: string;
  // Lockdown marker echoed by the controller into the magic-login response
  // so the frontend can persist it on the localStorage user object.
  inviteScope: { testId: string; lockedToTest: true };
}

@Injectable()
export class MagicLinkService {
  private readonly logger = new Logger(MagicLinkService.name);

  constructor(
    @InjectRepository(MagicLink)
    private readonly linksRepo: Repository<MagicLink>,
    @InjectRepository(Test)
    private readonly testsRepo: Repository<Test>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(TestParticipation)
    private readonly participationsRepo: Repository<TestParticipation>,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly examSetService: ExamSetService,
  ) {}

  private async resolveOrCreateUserFromLink(link: MagicLink): Promise<User> {
    if (link.userId) {
      const u = await this.usersRepo.findOne({ where: { id: link.userId } });
      if (u) return await this.maybeBackfillProfile(u, link);
    }
    const existing = await this.usersRepo.findOne({ where: { email: link.email } });
    if (existing) return await this.maybeBackfillProfile(existing, link);

    try {
      return await this.usersRepo.save(
        this.usersRepo.create({
          email: link.email,
          firstName: link.prefillFirstName,
          lastName: link.prefillLastName,
          mobile: link.prefillMobile,
          role: UserRole.STUDENT,
          password: null,
          profileComplete: Boolean(link.prefillFirstName && link.prefillLastName),
        }),
      );
    } catch (err: any) {
      // Lost the race vs concurrent magic-login for the same email — re-fetch.
      if (
        err?.code === 'ER_DUP_ENTRY' ||
        err?.code === '23505' ||
        String(err?.message || '').includes('Duplicate entry')
      ) {
        const winner = await this.usersRepo.findOne({ where: { email: link.email } });
        if (winner) return await this.maybeBackfillProfile(winner, link);
      }
      throw err;
    }
  }

  private async maybeBackfillProfile(user: User, link: MagicLink): Promise<User> {
    if (!user.firstName && link.prefillFirstName) {
      user.firstName = link.prefillFirstName;
      user.lastName = link.prefillLastName ?? user.lastName;
      user.mobile = link.prefillMobile ?? user.mobile;
      user.profileComplete = Boolean(user.firstName && user.lastName);
      return this.usersRepo.save(user);
    }
    return user;
  }

  private async pickSetForLink(testId: string): Promise<string | null> {
    return await this.examSetService
      .pickRoundRobin(testId, async (sid) => this.linksRepo.count({ where: { testId, setId: sid } }))
      .then((s) => s?.id || null);
  }

  private get appBaseUrl(): string {
    return (
      this.config.get<string>('APP_BASE_URL') ||
      this.config.get<string>('app.baseUrl') ||
      'http://localhost:3000'
    );
  }

  async createBulk(
    testId: string,
    rows: InviteRowDto[],
  ): Promise<{ created: MagicLink[]; queued: number; queueName: string }> {
    const test = await this.testsRepo.findOne({ where: { id: testId } });
    if (!test) throw new NotFoundException('Test not found');

    // When the test has no schedule, default the invite window to "open now"
    // (with a 60s grace into the past to absorb MySQL TIMESTAMP rounding +
    // clock skew between invite-create and immediate consume) and 7 days out.
    const validFrom = test.startsAt ?? new Date(Date.now() - 60_000);
    const validUntil = test.endsAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const created: MagicLink[] = [];
    const mailPayloads: Array<{ to: string; candidateName: string | null; testTitle: string; link: string; validFrom: Date; validUntil: Date; requireSafeExamBrowser?: boolean; sebConfigUrl?: string }> = [];

    // Ensure default set exists; admin may pre-assign per row
    await this.examSetService.ensureDefaultSet(testId);

    // Pre-fetch all existing links by email in ONE query — avoids N+1 round-trips.
    const normalizedEmails = rows
      .map((r) => r.email.trim().toLowerCase())
      .filter(Boolean);
    const dedupedEmails = Array.from(new Set(normalizedEmails));
    const existingLinks = dedupedEmails.length
      ? await this.linksRepo
          .createQueryBuilder('m')
          .where('m.testId = :testId', { testId })
          .andWhere('m.email IN (:...emails)', { emails: dedupedEmails })
          .getMany()
      : [];
    const existingByEmail = new Map(existingLinks.map((l) => [l.email, l]));

    const toSave: MagicLink[] = [];
    const rowByEmail = new Map<string, { row: InviteRowDto; token: string }>();
    for (const row of rows) {
      const email = row.email.trim().toLowerCase();
      if (!email) continue;
      const token = crypto.randomBytes(32).toString('hex');
      rowByEmail.set(email, { row, token });

      const existing = existingByEmail.get(email);
      if (existing) {
        existing.token = token;
        existing.prefillFirstName = row.firstName ?? existing.prefillFirstName ?? null;
        existing.prefillLastName = row.lastName ?? existing.prefillLastName ?? null;
        existing.prefillMobile = row.mobile ?? existing.prefillMobile ?? null;
        existing.setId = row.setId ?? existing.setId ?? null;
        existing.validFrom = validFrom;
        existing.validUntil = validUntil;
        if (existing.status === MagicLinkStatus.EXPIRED || existing.status === MagicLinkStatus.REVOKED) {
          existing.status = MagicLinkStatus.PENDING;
        }
        toSave.push(existing);
      } else {
        toSave.push(
          this.linksRepo.create({
            token,
            email,
            testId,
            prefillFirstName: row.firstName ?? null,
            prefillLastName: row.lastName ?? null,
            prefillMobile: row.mobile ?? null,
            setId: row.setId ?? null,
            validFrom,
            validUntil,
            status: MagicLinkStatus.PENDING,
          }),
        );
      }
    }

    // One round-trip for all rows. TypeORM batches this internally.
    const savedLinks = toSave.length > 0 ? await this.linksRepo.save(toSave) : [];

    for (const link of savedLinks) {
      created.push(link);
      const candidateName =
        [link.prefillFirstName, link.prefillLastName].filter(Boolean).join(' ') || null;
      // For SEB-required tests, point the candidate at sebs://… instead of
      // https://… The OS hands sebs:// URLs to Safe Exam Browser, which then
      // fetches the .seb config over HTTPS and launches the exam — one
      // click instead of "download file → open with SEB". The plain HTTPS
      // URL stays available in the email as a fallback for clients that
      // don't have the protocol handler registered.
      const sebsUrl = test.requireSafeExamBrowser
        ? `${this.appBaseUrl}/api/exam/${link.token}/seb-config`.replace(/^https?:\/\//, 'sebs://')
        : undefined;
      mailPayloads.push({
        to: link.email,
        candidateName,
        testTitle: test.title,
        link: `${this.appBaseUrl}/exam/${link.token}`,
        validFrom,
        validUntil,
        requireSafeExamBrowser: !!test.requireSafeExamBrowser,
        sebConfigUrl: sebsUrl,
      });
    }

    // Async send via BullMQ queue — non-blocking, parallel workers, retry on failure.
    const enq = await this.mail.enqueueInvites(mailPayloads);
    return { created, queued: enq.jobIds.length, queueName: enq.queueName };
  }

  async getMailQueueStats() {
    return this.mail.getQueueStats();
  }

  async listByTest(testId: string): Promise<MagicLink[]> {
    return this.linksRepo.find({
      where: { testId },
      order: { createdAt: 'DESC' },
    });
  }

  async revoke(linkId: string): Promise<MagicLink> {
    const link = await this.linksRepo.findOne({ where: { id: linkId } });
    if (!link) throw new NotFoundException('Invite not found');
    link.status = MagicLinkStatus.REVOKED;
    const saved = await this.linksRepo.save(link);
    // Also reset any in-progress participation so the candidate's existing JWT can't continue.
    if (link.userId) {
      await this.participationsRepo.update(
        { userId: link.userId, testId: link.testId, status: ParticipationStatus.IN_PROGRESS },
        { status: ParticipationStatus.RESET, resetAt: new Date() },
      );
    }
    return saved;
  }

  async resend(linkId: string): Promise<{ delivered: boolean }> {
    const link = await this.linksRepo.findOne({
      where: { id: linkId },
      relations: ['test'],
    });
    if (!link) throw new NotFoundException('Invite not found');
    if (link.status === MagicLinkStatus.SUBMITTED) {
      throw new BadRequestException('Candidate has already submitted; cannot resend.');
    }
    if (link.status === MagicLinkStatus.REVOKED) {
      throw new BadRequestException('Invite is revoked.');
    }
    const candidateName =
      [link.prefillFirstName, link.prefillLastName].filter(Boolean).join(' ') || null;
    return this.mail.sendInvite({
      to: link.email,
      candidateName,
      testTitle: link.test.title,
      link: `${this.appBaseUrl}/exam/${link.token}`,
      validFrom: link.validFrom,
      validUntil: link.validUntil,
    });
  }

  async validateAndConsume(token: string): Promise<MagicLinkValidation> {
    const link = await this.linksRepo.findOne({
      where: { token },
      relations: ['test'],
    });
    if (!link) throw new NotFoundException('Invalid or unknown link.');

    if (link.status === MagicLinkStatus.SUBMITTED) {
      throw new BadRequestException('You have already submitted this exam.');
    }
    if (link.status === MagicLinkStatus.REVOKED) {
      throw new BadRequestException('This invite has been revoked.');
    }

    // Re-resolve window from the current Test (admin may have moved it after invite create)
    const liveStartsAt = link.test?.startsAt ?? link.validFrom;
    const liveEndsAt = link.test?.endsAt ?? link.validUntil;
    if (
      (link.test?.startsAt && new Date(link.test.startsAt).getTime() !== link.validFrom.getTime()) ||
      (link.test?.endsAt && new Date(link.test.endsAt).getTime() !== link.validUntil.getTime())
    ) {
      link.validFrom = new Date(liveStartsAt);
      link.validUntil = new Date(liveEndsAt);
      await this.linksRepo.save(link);
    }

    const now = new Date();
    if (now < link.validFrom) {
      throw new BadRequestException({
        message: `Exam has not started yet. Starts at ${link.validFrom.toISOString()}.`,
        errors: {
          code: 'NOT_STARTED',
          startsAt: link.validFrom,
          endsAt: link.validUntil,
          serverTime: now.toISOString(),
          testTitle: link.test?.title,
        },
      });
    }
    if (now > link.validUntil) {
      link.status = MagicLinkStatus.EXPIRED;
      await this.linksRepo.save(link);
      throw new BadRequestException({
        message: `This invite has expired. Window closed at ${link.validUntil.toISOString()}.`,
        errors: {
          code: 'WINDOW_CLOSED',
          startsAt: link.validFrom,
          endsAt: link.validUntil,
          serverTime: now.toISOString(),
          testTitle: link.test?.title,
        },
      });
    }

    // Resolve / create user with race-safe insert (catch ER_DUP_ENTRY → re-fetch)
    const user = await this.resolveOrCreateUserFromLink(link);

    if (!link.userId) link.userId = user.id;
    if (!link.usedAt) link.usedAt = now;
    if (!link.setId) {
      // Round-robin auto-pick from active sets
      link.setId = await this.pickSetForLink(link.testId);
    }
    link.status = MagicLinkStatus.ACTIVE;
    await this.linksRepo.save(link);

    // Mint a SCOPE-LOCKED JWT for the candidate. The `inviteScope` claim
    // tags this session as "only allowed to access link.testId". The
    // server-side InviteScopeGuard reads this claim from req.user on every
    // request and 403s any out-of-scope access — even if the candidate
    // forges a different testId in the URL or body.
    //
    // Admin / password-based logins use a different code path and never
    // include inviteScope, so they remain free-roam.
    const accessToken = this.jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      inviteScope: {
        testId: link.testId,
        magicLinkId: link.id,
        lockedToTest: true,
      },
    });

    return {
      user,
      test: link.test,
      link,
      profileComplete: Boolean(user.profileComplete && user.firstName && user.lastName),
      accessToken,
      // Surface the scope to the frontend so it can write it into the
      // localStorage user object and apply soft redirects (UX). The hard
      // gate is server-side via InviteScopeGuard.
      inviteScope: {
        testId: link.testId,
        lockedToTest: true as const,
      },
    };
  }

  async completeProfile(token: string, dto: CompleteProfileDto): Promise<User> {
    const link = await this.linksRepo.findOne({ where: { token } });
    if (!link) throw new NotFoundException('Invalid link.');
    if (!link.userId) throw new BadRequestException('Link not yet activated.');
    const user = await this.usersRepo.findOne({ where: { id: link.userId } });
    if (!user) throw new NotFoundException('User missing.');
    user.firstName = dto.firstName;
    user.lastName = dto.lastName;
    user.mobile = dto.mobile ?? user.mobile;
    user.profileComplete = true;
    return this.usersRepo.save(user);
  }

  async getActiveLinkForUserTest(userId: string, testId: string): Promise<MagicLink | null> {
    return this.linksRepo.findOne({
      where: { userId, testId },
      order: { createdAt: 'DESC' },
    });
  }

  async markSubmittedByUserAndTest(userId: string, testId: string): Promise<void> {
    const link = await this.linksRepo.findOne({ where: { userId, testId } });
    if (!link) return;
    link.status = MagicLinkStatus.SUBMITTED;
    link.submittedAt = new Date();
    await this.linksRepo.save(link);
  }
}
