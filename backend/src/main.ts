import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as compression from 'compression';
import * as cluster from 'cluster';
import { cpus } from 'os';
import { AppModule } from './app.module';

// Node.js cluster mode. When NODE_CLUSTER=true, the primary forks WORKERS
// child processes, each running its own Nest app on the same port.
// Linux/Node's round-robin scheduler distributes incoming connections.
//
// Why: NestJS is single-threaded per process. On a 4-vCPU host a single
// process saturates one core and leaves three idle under burst load.
// Forking gives us ~3-4× request throughput at the cost of ~80 MB extra
// RSS per worker.
//
// Caveats accepted in this PR:
//   - BullMQ workers run in EVERY worker. Bull is multi-consumer-safe,
//     so jobs aren't double-processed; we just have N consumers pulling
//     from the same queue. That's fine.
//   - Socket.IO state is per-process. Admin live monitor will only see
//     events emitted by the worker that the WS client landed on. Fix is
//     `@socket.io/redis-adapter` — out of scope here. Candidates don't
//     use WS so the exam path is unaffected.
//
// Env knobs:
//   NODE_CLUSTER=true|false   (default: false in dev, true in compose)
//   WORKERS=<n>               (default: cpus().length, capped to 8)
const c: any = cluster as any;
const isPrimary = (c.isPrimary ?? c.isMaster ?? true) === true;
const clusterEnabled = process.env.NODE_CLUSTER === 'true';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') || 4000;

  // Helmet — apply only the headers that make sense on JSON API responses.
  // We disable:
  //   - contentSecurityPolicy: API responses are JSON, CSP is meaningful
  //     only on HTML. The Caddy edge sets per-request HTML headers; this
  //     also prevents conflicts with browser caching.
  //   - crossOriginEmbedderPolicy: default 'require-corp' would forbid
  //     loading question/option images from GCS unless GCS responses
  //     carry a CORP header (they don't by default).
  //   - crossOriginResourcePolicy: scoped to 'same-site' so /api/* JSON
  //     responses are not embeddable cross-site.
  // Helmet still sets: HSTS, X-DNS-Prefetch-Control, X-Download-Options,
  // Origin-Agent-Cluster, X-XSS-Protection: 0, X-Permitted-Cross-Domain-Policies.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(compression());

  // CORS_ORIGIN is a comma-separated list of allowed origins. Falls back to
  // localhost for dev. In prod set CORS_ORIGIN=https://exam.example.com.
  // credentials=false because the app uses Authorization: Bearer headers
  // exclusively — no cookies. Forbidding credentials here narrows the
  // CORS preflight surface and prevents any future cookie-based mistake.
  const corsEnv = configService.get<string>('CORS_ORIGIN') || 'http://localhost:3000,http://localhost:3001';
  const corsOrigins = corsEnv.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({
    origin: corsOrigins,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.listen(port);
  logger.log(`Server running on http://localhost:${port} (pid=${process.pid})`);
  logger.log(`Environment: ${configService.get('NODE_ENV')}`);
}

if (clusterEnabled && isPrimary) {
  const workers = Math.min(8, parseInt(process.env.WORKERS || String(cpus().length), 10));
  // eslint-disable-next-line no-console
  console.log(`[cluster] primary pid=${process.pid} forking ${workers} workers`);
  for (let i = 0; i < workers; i++) c.fork();
  c.on('exit', (worker: any, code: number, signal: string) => {
    // eslint-disable-next-line no-console
    console.warn(`[cluster] worker pid=${worker.process.pid} died (${signal || code}); respawning`);
    c.fork();
  });
} else {
  bootstrap();
}
