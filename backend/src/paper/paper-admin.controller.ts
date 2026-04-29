import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
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
  setQuestions(@Param('paperId', ParseUUIDPipe) paperId: string, @Body() dto: SetPaperQuestionsDto) {
    return this.paperService.setPaperQuestions(paperId, dto);
  }
}

