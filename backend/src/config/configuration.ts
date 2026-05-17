// Known weak/default values that ship with the repo or get copy-pasted from
// quickstarts. If any required secret matches one of these in production, the
// app refuses to boot — preventing a deploy that ships with `JWT_SECRET=
// 'fallback-secret'` and lets anyone forge tokens.
const KNOWN_DEFAULTS = new Set<string>([
  'fallback-secret', 'codeassess_secret', 'change-me', 'changeme',
  'secret', 'password', 'redis', 'jwt-secret', 'dev', 'admin',
  'codeassess', 'test', 'example',
]);

/**
 * Read an env var with strict production validation.
 *
 * In `NODE_ENV=production`:
 *   - Throws if the value is empty, matches a known default, or is shorter
 *     than `minLen`. The error message contains ONLY the variable name —
 *     never echoes the value (so it's safe to log).
 * In dev:
 *   - Logs a warning when using a weak/empty value but allows boot, so a
 *     fresh checkout still starts without ceremony.
 */
function requireEnv(key: string, opts?: { minLen?: number; devFallback?: string }): string {
  const v = (process.env[key] || '').trim();
  const inProd = process.env.NODE_ENV === 'production';
  const minLen = opts?.minLen ?? 1;
  const isDefault = KNOWN_DEFAULTS.has(v.toLowerCase());
  const tooShort = v.length < minLen;

  if (inProd) {
    if (!v || isDefault || tooShort) {
      throw new Error(
        `[security] ${key} must be set (>=${minLen} chars, not a known default) in production`,
      );
    }
    return v;
  }

  // Dev: warn but allow.
  if (!v || isDefault) {
    // eslint-disable-next-line no-console
    console.warn(`[security] WARNING: ${key} using insecure dev default; set ${key} in .env`);
    return opts?.devFallback ?? v ?? '';
  }
  return v;
}

export default () => ({
  port: parseInt(process.env.PORT || '4000', 10),
  database: {
    type: process.env.DB_TYPE || 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3307', 10),
    username: process.env.DB_USERNAME || 'codeassess',
    password: requireEnv('DB_PASSWORD', { minLen: 12, devFallback: 'codeassess_secret' }),
    name: process.env.DB_NAME || 'codeassess',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6380', 10),
    // Redis password is empty in some local setups (no auth). Allow empty in
    // dev, require in prod.
    password: process.env.NODE_ENV === 'production'
      ? requireEnv('REDIS_PASSWORD', { minLen: 12 })
      : (process.env.REDIS_PASSWORD || ''),
  },
  jwt: {
    secret: requireEnv('JWT_SECRET', { minLen: 32, devFallback: 'dev-only-jwt-secret-do-not-use-this-anywhere-real' }),
    expiration: process.env.JWT_EXPIRATION || '24h',
  },
  judge0: {
    apiUrl: process.env.JUDGE0_API_URL || 'http://localhost:2358',
    apiKey: process.env.JUDGE0_API_KEY || '',
  },
});
