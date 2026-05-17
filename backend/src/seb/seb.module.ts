import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { SebService } from './seb.service';
import { SebController } from './seb.controller';
import { SebGuard } from '../common/guards/seb.guard';
import { Test } from '../tests/test.entity';
import { MagicLink } from '../magic-link/magic-link.entity';
import { ViolationLog } from '../test-session/violation-log.entity';
import { TestParticipation } from '../results/test-participation.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Test, MagicLink, ViolationLog, TestParticipation]),
  ],
  providers: [SebService, SebGuard],
  controllers: [SebController],
  exports: [SebService, SebGuard],
})
export class SebModule {}
