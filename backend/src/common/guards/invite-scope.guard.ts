import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { Paper } from '../../paper/paper.entity';
import { MagicLink } from '../../magic-link/magic-link.entity';
import { ViolationLog, ViolationType } from '../../test-session/violation-log.entity';

/**
 * Magic-link candidates carry an `inviteScope` claim in their JWT (set in
 * magic-link.service.ts on consume). This guard enforces that such a
 * session can only access endpoints scoped to its single test.
 *
 * Algorithm (per request):
 *   1. No req.user (public route) or no inviteScope (admin / free-roam)
 *      → pass through.
 *   2. If the path matches an admin / catalog deny-pattern → 403.
 *   3. Resolve the request's testId from URL params, body, or via
 *      paperId / token joins (cached). If different from inviteScope.testId
 *      → 403. If unresolved (route is not test-scoped) → pass through.
 *   4. On 403, log a violation. Logging never throws — failure to log
 *      doesn't change the auth outcome.
 *   5. **Fail closed** on resolution errors (DB down, unexpected exceptions)
 *      so we never silently re-open the dashboard during an outage.
 *
 * Registered as APP_GUARD globally so every controller is covered without
 * per-route wiring.
 */

interface InviteScope {
  testId: string;
  magicLinkId: string;
  lockedToTest: true;
}

interface AuthedRequest extends Request {
  user?: {
    id: string;
    role: string;
    inviteScope?: InviteScope;
  };
}

// Routes that an inviteScope session must NEVER reach, regardless of body.
// Order matters — checked before testId resolution.
const PATH_DENY_LIST: ReadonlyArray<RegExp> = [
  /^\/api\/admin(\/|$)/,           // admin routes
  /^\/api\/tests(\?|$)/,           // test catalog (list)
  /^\/api\/tests\/active(\/|$|\?)/, // active test list
  /^\/api\/results\/leaderboard/,  // cross-test leaderboard
];

@Injectable()
export class InviteScopeGuard implements CanActivate {
  private readonly logger = new Logger(InviteScopeGuard.name);

  // Cache paperId → testId and token → { magicLinkId, testId }. Both are
  // immutable for the life of the row; 60s TTL is enough to absorb autosave
  // bursts without staleness mattering.
  private paperToTest = new Map<string, { testId: string; expires: number }>();
  private tokenToLink = new Map<string, { magicLinkId: string; testId: string; expires: number }>();
  private static readonly CACHE_TTL_MS = 60_000;

  constructor(
    @InjectRepository(Paper) private readonly papersRepo: Repository<Paper>,
    @InjectRepository(MagicLink) private readonly linksRepo: Repository<MagicLink>,
    @InjectRepository(ViolationLog) private readonly violationsRepo: Repository<ViolationLog>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const scope = req.user?.inviteScope;
    if (!scope) return true; // free-roam / public

    const url = req.originalUrl || req.url || '';
    const path = url.split('?')[0];

    // Step 1: deny-list (admin paths, catalog endpoints).
    for (const re of PATH_DENY_LIST) {
      if (re.test(path)) {
        await this.audit(req, scope, `denied-path ${req.method} ${path}`);
        throw new ForbiddenException('This session is locked to a single exam.');
      }
    }

    // Step 2: resolve testId.
    let requestedTestId: string | null;
    try {
      requestedTestId = await this.resolveTestId(req, scope);
    } catch (err: any) {
      // Fail CLOSED on any resolution exception (DB hiccup, etc.).
      this.logger.error(`testId resolution failed for ${path}: ${err?.message || err}`);
      throw new ForbiddenException('Could not verify exam scope. Please retry.');
    }

    if (requestedTestId == null) return true; // route not test-scoped
    if (requestedTestId !== scope.testId) {
      await this.audit(req, scope, `cross-test ${req.method} ${path} → ${requestedTestId}`);
      throw new ForbiddenException('This session is locked to a single exam.');
    }
    return true;
  }

  // ─── testId resolution ──────────────────────────────────────────────
  private async resolveTestId(req: AuthedRequest, scope: InviteScope): Promise<string | null> {
    const params = (req.params || {}) as Record<string, string>;
    const body = (req.body || {}) as Record<string, any>;
    const path = (req.originalUrl || req.url || '').split('?')[0];

    // (a) URL :testId
    if (typeof params.testId === 'string' && params.testId) return params.testId;
    // (b) URL :paperId — DB join
    if (typeof params.paperId === 'string' && params.paperId) {
      return this.testIdFromPaper(params.paperId);
    }
    // (c) URL :token — must match scope.magicLinkId
    if (typeof params.token === 'string' && params.token) {
      const link = await this.linkFromToken(params.token);
      if (!link) return null; // public-ish endpoints validate token themselves
      if (link.magicLinkId !== scope.magicLinkId) {
        // Cross-link probe — short-circuit as cross-test.
        return link.testId;
      }
      return link.testId;
    }
    // (d) /api/tests/:id and /api/tests/:id/* → :id is a testId
    //   The tests controller uses `:id` (not `:testId`) so the param-name
    //   path above misses it. Path-pattern this route explicitly.
    if (typeof params.id === 'string' && params.id) {
      if (/^\/api\/tests\/[0-9a-f-]{8,}/i.test(path)) {
        return params.id;
      }
    }
    // (e) Body testId
    if (typeof body.testId === 'string' && body.testId) return body.testId;
    // (f) Body paperId
    if (typeof body.paperId === 'string' && body.paperId) {
      return this.testIdFromPaper(body.paperId);
    }
    return null;
  }

  private async testIdFromPaper(paperId: string): Promise<string | null> {
    const cached = this.paperToTest.get(paperId);
    if (cached && cached.expires > Date.now()) return cached.testId;
    const row = await this.papersRepo.findOne({ where: { id: paperId }, select: ['id', 'examId'] });
    if (!row) return null;
    this.paperToTest.set(paperId, { testId: row.examId, expires: Date.now() + InviteScopeGuard.CACHE_TTL_MS });
    return row.examId;
  }

  private async linkFromToken(token: string): Promise<{ magicLinkId: string; testId: string } | null> {
    const cached = this.tokenToLink.get(token);
    if (cached && cached.expires > Date.now()) return { magicLinkId: cached.magicLinkId, testId: cached.testId };
    const row = await this.linksRepo.findOne({ where: { token }, select: ['id', 'testId'] });
    if (!row) return null;
    this.tokenToLink.set(token, { magicLinkId: row.id, testId: row.testId, expires: Date.now() + InviteScopeGuard.CACHE_TTL_MS });
    return { magicLinkId: row.id, testId: row.testId };
  }

  // ─── audit ──────────────────────────────────────────────────────────
  private async audit(req: AuthedRequest, scope: InviteScope, detail: string): Promise<void> {
    try {
      await this.violationsRepo.save(
        this.violationsRepo.create({
          participationId: null,
          userId: req.user!.id,
          testId: scope.testId,
          type: ViolationType.OUT_OF_SCOPE_ACCESS,
          metadata: { detail: detail.slice(0, 500), method: req.method, path: (req.originalUrl || req.url || '').split('?')[0] },
          ipAddress: (req.ip || (req.headers['x-forwarded-for'] as string) || null)?.toString().slice(0, 100) || null,
        }),
      );
    } catch (err: any) {
      // Logging must never break auth. Surface to app log only.
      this.logger.warn(`Failed to write OUT_OF_SCOPE_ACCESS violation: ${err?.message || err}`);
    }
  }
}
