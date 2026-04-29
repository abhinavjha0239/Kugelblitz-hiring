import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { TestSessionService } from './test-session.service';
import {
  SaveMcqAnswerDto,
  SubmitMcqSectionDto,
  SubmitCodingDto,
  FinalSubmitDto,
  AntiCheatDto,
  TrackQuestionTimeDto,
} from './dto/test-session.dto';
import { AutosavePaperAnswersDto, SubmitPaperDto } from '../paper/dto/paper-session.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../users/user.entity';

@Controller('test-session')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TestSessionController {
  constructor(private testSessionService: TestSessionService) {}

  @Post('start/:testId')
  async startTest(
    @Param('testId', ParseUUIDPipe) testId: string,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    const result = await this.testSessionService.startTest(userId, testId);
    const ip = req.ip || req.headers['x-forwarded-for']?.toString() || 'unknown';
    await this.testSessionService.recordIpAddress(userId, testId, ip);
    return result;
  }

  @Post('student/start-exam/:testId')
  startExam(@Param('testId', ParseUUIDPipe) testId: string, @CurrentUser('id') userId: string) {
    return this.testSessionService.startExamSession(userId, testId);
  }

  @Post('student/start-paper/:paperId')
  startPaper(@Param('paperId', ParseUUIDPipe) paperId: string, @CurrentUser('id') userId: string) {
    return this.testSessionService.startPaper(userId, paperId);
  }

  @Post('student/submit-paper/:paperId')
  submitPaper(
    @Param('paperId', ParseUUIDPipe) paperId: string,
    @Body() dto: SubmitPaperDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.testSessionService.submitPaper(userId, paperId, dto.answers);
  }

  @Post('student/paper/:paperId/autosave')
  autosavePaper(
    @Param('paperId', ParseUUIDPipe) paperId: string,
    @Body() dto: AutosavePaperAnswersDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.testSessionService.autosavePaperAnswers(userId, paperId, dto.answers);
  }

  @Get('student/exam-status/:testId')
  examStatus(@Param('testId', ParseUUIDPipe) testId: string, @CurrentUser('id') userId: string) {
    return this.testSessionService.getExamStatus(userId, testId);
  }

  @Get('status/:testId')
  getStatus(
    @Param('testId', ParseUUIDPipe) testId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.testSessionService.getSessionStatus(userId, testId);
  }

  @Post('mcq/save')
  saveMcqAnswer(
    @Body() dto: SaveMcqAnswerDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.testSessionService.saveMcqAnswer(userId, dto.testId, dto.questionId, dto.selectedOption);
  }

  @Post('mcq/submit')
  submitMcqSection(
    @Body() dto: SubmitMcqSectionDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.testSessionService.submitMcqSection(userId, dto.testId);
  }

  @Post('coding/submit')
  submitCoding(
    @Body() dto: SubmitCodingDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.testSessionService.submitCoding(
      userId, dto.testId, dto.questionId, dto.languageId, dto.sourceCode,
    );
  }

  @Post('final-submit')
  finalSubmit(
    @Body() dto: FinalSubmitDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.testSessionService.finalSubmit(userId, dto.testId, dto.isAutoSubmit);
  }

  @Get('timer/:testId')
  getTimer(
    @Param('testId', ParseUUIDPipe) testId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.testSessionService.getTimerState(userId, testId);
  }

  @Post('anti-cheat')
  logAntiCheat(
    @Body() dto: AntiCheatDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for']?.toString();
    return this.testSessionService.logAntiCheat(userId, dto.testId, dto.type, ip);
  }

  @Post('track-time')
  trackQuestionTime(
    @Body() dto: TrackQuestionTimeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.testSessionService.trackQuestionTime(userId, dto.testId, dto.questionId, dto.timeSpentSeconds);
  }

  // ─── ADMIN ENDPOINTS ──────────────────────────────────────
  @Get('admin/active-users/:testId')
  @Roles(UserRole.ADMIN)
  getActiveUsers(@Param('testId', ParseUUIDPipe) testId: string) {
    return this.testSessionService.getActiveUsers(testId);
  }

  @Get('admin/violations/:testId')
  @Roles(UserRole.ADMIN)
  getViolations(@Param('testId', ParseUUIDPipe) testId: string) {
    return this.testSessionService.getViolations(testId);
  }

  @Get('admin/results/:testId')
  @Roles(UserRole.ADMIN)
  getResultsWithProctoring(@Param('testId', ParseUUIDPipe) testId: string) {
    return this.testSessionService.getResultsWithProctoring(testId);
  }

  @Post('admin/reset-attempt/:testId/:userId')
  @Roles(UserRole.ADMIN)
  resetTestAttempt(
    @Param('testId', ParseUUIDPipe) testId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.testSessionService.resetTestAttempt(adminId, testId, userId);
  }

  @Get('admin/action-logs/:testId')
  @Roles(UserRole.ADMIN)
  getActionLogs(@Param('testId', ParseUUIDPipe) testId: string) {
    return this.testSessionService.getActionLogs(testId);
  }
}
