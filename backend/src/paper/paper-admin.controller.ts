import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { PaperService } from './paper.service';
import { CreatePaperDto, SetPaperQuestionsDto, UpdatePaperDto } from './dto/paper-admin.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';

@Controller('admin/papers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PaperAdminController {
  constructor(private readonly paperService: PaperService) {}

  @Post()
  create(@Body() dto: CreatePaperDto) {
    return this.paperService.createPaper(dto);
  }

  @Get('exam/:examId')
  listByExam(@Param('examId', ParseUUIDPipe) examId: string) {
    return this.paperService.listExamPapers(examId);
  }

  @Put(':paperId')
  update(@Param('paperId', ParseUUIDPipe) paperId: string, @Body() dto: UpdatePaperDto) {
    return this.paperService.updatePaper(paperId, dto);
  }

  @Delete(':paperId')
  remove(@Param('paperId', ParseUUIDPipe) paperId: string) {
    return this.paperService.deletePaper(paperId);
  }

  @Put(':paperId/questions')
  setQuestions(
    @Param('paperId', ParseUUIDPipe) paperId: string,
    @Body() dto: SetPaperQuestionsDto,
    @Query('setId') setId?: string,
  ) {
    return this.paperService.setPaperQuestions(paperId, dto, setId);
  }

  @Get('exam/:examId/mapping')
  mapping(@Param('examId', ParseUUIDPipe) examId: string, @Query('setId') setId?: string) {
    return this.paperService.getQuestionMapping(examId, setId);
  }

  @Get(':paperId/questions')
  paperQuestions(@Param('paperId', ParseUUIDPipe) paperId: string, @Query('setId') setId?: string) {
    return this.paperService.getPaperQuestions(paperId, setId);
  }

  @Patch(':paperId/questions/:questionId')
  addOne(
    @Param('paperId', ParseUUIDPipe) paperId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Query('setId') setId?: string,
  ) {
    return this.paperService.addQuestionToPaper(paperId, questionId, setId);
  }

  @Delete(':paperId/questions/:questionId')
  removeOne(
    @Param('paperId', ParseUUIDPipe) paperId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Query('setId') setId?: string,
  ) {
    return this.paperService.removeQuestionFromPaper(paperId, questionId, setId);
  }

  @Post(':paperId/questions/reorder')
  reorder(
    @Param('paperId', ParseUUIDPipe) paperId: string,
    @Body() dto: SetPaperQuestionsDto,
    @Query('setId') setId?: string,
  ) {
    return this.paperService.reorderPaperQuestions(paperId, dto.questionIds, setId);
  }

  @Post(':paperId/questions/bulk-add')
  bulkAdd(
    @Param('paperId', ParseUUIDPipe) paperId: string,
    @Body() dto: SetPaperQuestionsDto,
    @Query('setId') setId?: string,
  ) {
    return this.paperService.bulkAddQuestionsToPaper(paperId, dto.questionIds, setId);
  }

  @Post('exam/:examId/auto-assign-by-section')
  autoAssign(@Param('examId', ParseUUIDPipe) examId: string, @Query('setId') setId?: string) {
    return this.paperService.autoAssignBySection(examId, setId);
  }
}

