import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MonitoringGateway } from './monitoring.gateway';
import { TestParticipation } from '../results/test-participation.entity';
import { User } from '../users/user.entity';
import { Paper } from '../paper/paper.entity';
import { StudentPaperSession } from '../paper/student-paper-session.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([TestParticipation, User, Paper, StudentPaperSession]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: { expiresIn: config.get<string>('jwt.expiration') || '24h' },
      }),
    }),
  ],
  providers: [MonitoringGateway],
  exports: [MonitoringGateway],
})
export class MonitoringModule {}
