import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { SubmissionsService } from './submissions.service';
import { CreateSubmissionDto, RunCodeDto } from './dto/create-submission.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../users/user.entity';

@Controller('submissions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubmissionsController {
  constructor(private submissionsService: SubmissionsService) {}

  @Post()
  create(@Body() dto: CreateSubmissionDto, @CurrentUser('id') userId: string) {
    return this.submissionsService.create(dto, userId);
  }

  @Post('run')
  runCode(@Body() dto: RunCodeDto) {
    return this.submissionsService.runCode(dto);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.submissionsService.findById(id, userId, role);
  }

  @Get('user/test/:testId')
  findMySubmissions(
    @Param('testId', ParseUUIDPipe) testId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.submissionsService.findByUserAndTest(userId, testId);
  }

  @Get('user/question/:questionId')
  findMyQuestionSubmissions(
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.submissionsService.findByUserAndQuestion(userId, questionId);
  }

  @Get('test/:testId/all')
  @Roles(UserRole.ADMIN)
  findTestSubmissions(
    @Param('testId', ParseUUIDPipe) testId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.submissionsService.findByTest(
      testId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }
}
