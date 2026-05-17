import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ResultsService } from './results.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../users/user.entity';
import { ReportAntiCheatDto } from './dto/anti-cheat.dto';

@Controller('results')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ResultsController {
  constructor(private resultsService: ResultsService) {}

  @Post('start/:testId')
  startTest(
    @Param('testId', ParseUUIDPipe) testId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.resultsService.startTest(userId, testId);
  }

  @Post('submit/:testId')
  submitTest(
    @Param('testId', ParseUUIDPipe) testId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.resultsService.submitTest(userId, testId);
  }

  @Post('anti-cheat/:testId')
  reportAntiCheat(
    @Param('testId', ParseUUIDPipe) testId: string,
    @CurrentUser('id') userId: string,
    @Body() body: ReportAntiCheatDto,
  ) {
    return this.resultsService.reportAntiCheat(userId, testId, body.type);
  }

  @Get('participation/:testId')
  getParticipation(
    @Param('testId', ParseUUIDPipe) testId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.resultsService.getParticipation(userId, testId);
  }

  @Get('monitor/:testId')
  @Roles(UserRole.ADMIN)
  getTestMonitor(@Param('testId', ParseUUIDPipe) testId: string) {
    return this.resultsService.getTestMonitor(testId);
  }

  @Get('leaderboard/:testId')
  @Roles(UserRole.ADMIN)
  getLeaderboard(@Param('testId', ParseUUIDPipe) testId: string) {
    return this.resultsService.getLeaderboard(testId);
  }

  @Get('detailed/:testId')
  getDetailedResult(
    @Param('testId', ParseUUIDPipe) testId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.resultsService.getDetailedResult(userId, testId);
  }

  @Get('detailed/:testId/user/:userId')
  @Roles(UserRole.ADMIN)
  getStudentResult(
    @Param('testId', ParseUUIDPipe) testId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.resultsService.getDetailedResult(userId, testId);
  }
}
