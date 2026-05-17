import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MagicLink } from './magic-link.entity';
import { MagicLinkService } from './magic-link.service';
import { MagicLinkController } from './magic-link.controller';
import { Test } from '../tests/test.entity';
import { User } from '../users/user.entity';
import { TestParticipation } from '../results/test-participation.entity';
import { MailModule } from '../mail/mail.module';
import { ExamSetModule } from '../exam-set/exam-set.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MagicLink, Test, User, TestParticipation]),
    MailModule,
    ExamSetModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: { expiresIn: config.get<string>('jwt.expiration') || '24h' },
      }),
    }),
  ],
  providers: [MagicLinkService],
  controllers: [MagicLinkController],
  exports: [MagicLinkService],
})
export class MagicLinkModule {}
