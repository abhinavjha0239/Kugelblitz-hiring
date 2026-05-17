import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ServeStaticModule } from '@nestjs/serve-static';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { join } from 'path';

import configuration from './config/configuration';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { InviteScopeGuard } from './common/guards/invite-scope.guard';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { Paper } from './paper/paper.entity';
import { MagicLink } from './magic-link/magic-link.entity';
import { ViolationLog } from './test-session/violation-log.entity';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { buildThrottlerOptions } from './common/throttler/throttler.config';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TestsModule } from './tests/tests.module';
import { QuestionsModule } from './questions/questions.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { QueueModule } from './queue/queue.module';
import { Judge0Module } from './judge0/judge0.module';
import { ResultsModule } from './results/results.module';
import { TestSessionModule } from './test-session/test-session.module';
import { PdfIngestionModule } from './pdf-ingestion/pdf-ingestion.module';
import { PaperModule } from './paper/paper.module';
import { ExamSetModule } from './exam-set/exam-set.module';
import { MagicLinkModule } from './magic-link/magic-link.module';
import { MailModule } from './mail/mail.module';
import { UploadsModule } from './uploads/uploads.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { SebModule } from './seb/seb.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql' as const,
        host: config.get<string>('database.host'),
        port: config.get<number>('database.port'),
        username: config.get<string>('database.username'),
        password: config.get<string>('database.password'),
        database: config.get<string>('database.name'),
        charset: 'utf8mb4',
        autoLoadEntities: true,
        synchronize: config.get('NODE_ENV') !== 'production',
        logging: config.get('NODE_ENV') === 'development' ? ['error'] : false,
        extra: {
          // 80 connections per Node process. With single-process this is
          // already 4× headroom over the previous 20. With cluster mode
          // (Phase B), 4 workers × 80 = 320 connections — paired below
          // with MySQL `max_connections=400` in docker-compose.
          connectionLimit: 80,
          waitForConnections: true,
          // 10s connection timeout — fail fast under saturation rather
          // than hanging forever and pinning the request queue.
          connectTimeout: 10_000,
        },
      }),
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('redis.host'),
          port: config.get('redis.port'),
          password: config.get('redis.password'),
        },
      }),
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/api/uploads',
      serveStaticOptions: { index: false, fallthrough: true },
    }),
    AuthModule,
    UsersModule,
    TestsModule,
    QuestionsModule,
    SubmissionsModule,
    QueueModule,
    Judge0Module,
    ResultsModule,
    TestSessionModule,
    PdfIngestionModule,
    PaperModule,
    ExamSetModule,
    MailModule,
    MagicLinkModule,
    UploadsModule,
    MonitoringModule,
    SebModule,
    // Repositories needed by the InviteScopeGuard. Registered here at the
    // app level (rather than inside a module) because the guard runs on
    // every request and must be a global APP_GUARD.
    TypeOrmModule.forFeature([Paper, MagicLink, ViolationLog]),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildThrottlerOptions(config),
    }),
  ],
  providers: [
    // Throttler runs FIRST in the guard chain. Rejects 429s before any
    // auth/role/scope work happens — saves DB lookups on hostile traffic.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Runs after JwtAuthGuard (req.user is set) and after RolesGuard (so
    // /api/admin/* paths get a 403 from RolesGuard for the non-admin role
    // BEFORE this guard fires). For inviteScope sessions we still hit the
    // path deny-list as belt-and-braces in case someone removes @Roles.
    { provide: APP_GUARD, useClass: InviteScopeGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
