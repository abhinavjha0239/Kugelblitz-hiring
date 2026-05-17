import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Test } from '../../tests/test.entity';
import { MagicLink } from '../../magic-link/magic-link.entity';
import {
  ViolationLog,
  ViolationType,
} from '../../test-session/violation-log.entity';
import { TestParticipation } from '../../results/test-participation.entity';
import { SebService } from '../../seb/seb.service';

// Apply with @UseGuards(JwtAuthGuard, SebGuard). Order matters — SebGuard
// reads req.user, which JwtAuthGuard populates.
//
// Behavior:
// - If the test does not require SEB → allow.
// - If the test requires SEB → verify X-SafeExamBrowser-RequestHash header
//   matches SHA256(URL + per-link BEK). Reject with 403 + violation log on
//   missing or mismatched hash.
@Injectable()
export class SebGuard implements CanActivate {
  private readonly logger = new Logger(SebGuard.name);

  constructor(
    @InjectRepository(Test) private testsRepo: Repository<Test>,
    @InjectRepository(MagicLink) private linksRepo: Repository<MagicLink>,
    @InjectRepository(ViolationLog)
    private violationsRepo: Repository<ViolationLog>,
    @InjectRepository(TestParticipation)
    private participationsRepo: Repository<TestParticipation>,
    private readonly sebService: SebService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req: any = ctx.switchToHttp().getRequest();
    const userId: string | undefined = req.user?.id;
    if (!userId) return true; // JwtAuthGuard handles missing auth

    // Admins access candidate-scoped routes for monitoring/preview;
    // they don't have a MagicLink so SEB lookup would always 403.
    // SEB lockdown is a candidate-only concern.
    if (req.user?.role && req.user.role !== 'student') return true;

    const testId = await this.resolveTestId(req);
    if (!testId) return true; // not a test-scoped route

    const test = await this.testsRepo.findOne({
      where: { id: testId },
      select: ['id', 'requireSafeExamBrowser'],
    });
    if (!test?.requireSafeExamBrowser) return true;

    // Pull every (bek, salt) pair this user has for this test. SEB 3.5+
    // derives the effective BEK as HMAC-SHA256(BEK_bytes, salt_bytes)
    // before hashing the URL — so we need the SAME salt the .seb was
    // generated with. Stored on the magic-link alongside the BEK.
    //
    // Multiple links possible if admin re-invited; try all so an older
    // .seb file still in the candidate's hands keeps working until the
    // link itself is revoked.
    const links = await this.linksRepo.find({
      where: { userId, testId },
      order: { createdAt: 'DESC' },
      select: ['id', 'sebBrowserExamKey', 'sebExamKeySalt'],
    });
    const usableLinks = links.filter((l) => !!l.sebBrowserExamKey);

    if (usableLinks.length === 0) {
      await this.logViolation(
        userId,
        testId,
        req,
        ViolationType.SEB_HEADER_MISSING,
        'No BEK provisioned for this candidate',
      );
      throw new ForbiddenException(
        'Exam requires Safe Exam Browser. Please open the .seb config from your invite email.',
      );
    }

    const ok = usableLinks.some((l) =>
      this.sebService.verifyRequestHash(req, l.sebBrowserExamKey!, l.sebExamKeySalt),
    );
    if (!ok) {
      const headerPresent = !!(
        req.headers?.['x-safeexambrowser-requesthash'] ||
        req.headers?.['X-SafeExamBrowser-RequestHash']
      );
      await this.logViolation(
        userId,
        testId,
        req,
        headerPresent
          ? ViolationType.SEB_HEADER_MISMATCH
          : ViolationType.SEB_HEADER_MISSING,
        (req.originalUrl || req.url || '').slice(0, 500),
      );
      throw new ForbiddenException(
        'SEB session invalid — please reopen the .seb config.',
      );
    }
    return true;
  }

  // SEB guard fires on routes scoped by either testId, paperId, or testId in
  // body. Resolve to a single test id; null means "not test-scoped" (allow).
  private async resolveTestId(req: any): Promise<string | null> {
    if (req.params?.testId) return req.params.testId;
    if (req.params?.paperId) {
      const rows: Array<{ exam_id: string }> = await this.testsRepo.manager.query(
        'SELECT exam_id FROM papers WHERE id = ? LIMIT 1',
        [req.params.paperId],
      );
      return rows?.[0]?.exam_id || null;
    }
    if (req.body?.testId && typeof req.body.testId === 'string') {
      return req.body.testId;
    }
    return null;
  }

  // Audit log every rejection. Writes to violation_logs with
  // participationId resolved best-effort. If no participation row exists
  // (e.g. the candidate never reached start-exam), we skip the DB write
  // and only console-log — the 403 itself still fires.
  private async logViolation(
    userId: string,
    testId: string,
    req: any,
    type: ViolationType,
    detail: string,
  ): Promise<void> {
    try {
      const participation = await this.participationsRepo.findOne({
        where: { userId, testId },
        order: { attemptNumber: 'DESC' },
        select: ['id'],
      });
      if (!participation?.id) {
        this.logger.warn(
          `SEB violation (no participation yet): user=${userId} test=${testId} type=${type} detail=${detail}`,
        );
        return;
      }
      await this.violationsRepo.save({
        participationId: participation.id,
        userId,
        testId,
        type,
        metadata: { detail },
        ipAddress: req.ip || null,
      } as Partial<ViolationLog>);
    } catch (err: any) {
      // Logging must never break the auth flow.
      this.logger.error(`Failed to log SEB violation: ${err.message}`);
    }
  }
}
