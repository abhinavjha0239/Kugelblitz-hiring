import { ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

/**
 * Rate-limit policy
 * ─────────────────
 * Global throttler: **6000 requests / 60s per IP**.
 *
 * Sized for college NAT — up to ~500 candidates can share one outbound
 * IP. At ~12 req/min/student during normal exam traffic (page load +
 * autosave + timer poll), that's ~6,000 r/min steady — this ceiling
 * absorbs natural bursts without blocking real candidates while still
 * capping a runaway client.
 *
 * This is a generic DoS shield, NOT a security mechanism. Real
 * brute-force protection lives elsewhere:
 *
 *   - **Per-paper autosave**: 60/min per (userId, paperId) in
 *     test-session.service.ts (`rl:autosave:`).
 *   - **Coding submit cooldown**: 3-second cooldown per (userId, testId)
 *     in test-session.service.ts (`ratelimit:`).
 *   - **InviteScopeGuard**: per-test JWT scope rejects cross-test access.
 *   - **JwtAuthGuard + RolesGuard**: standard auth gates.
 *
 * Bypass via @Throttle({ skipIf }) is intentionally NOT exposed — every
 * route gets the same ceiling.
 */
export function buildThrottlerOptions(config: ConfigService): ThrottlerModuleOptions {
  const redis = new Redis({
    host: config.get<string>('redis.host'),
    port: config.get<number>('redis.port'),
    password: config.get<string>('redis.password') || undefined,
    maxRetriesPerRequest: 3,
    lazyConnect: false,
    keyPrefix: 'thr:',
  });

  return {
    throttlers: [
      { name: 'default', ttl: 60_000, limit: 6000 },
    ],
    storage: new ThrottlerStorageRedisService(redis),
  };
}
