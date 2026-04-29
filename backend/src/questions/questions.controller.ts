import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { CreateQuestionDto, UpdateQuestionDto, CreateTestCaseDto } from './dto/create-question.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';

@Controller('questions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QuestionsController {
  constructor(private questionsService: QuestionsService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateQuestionDto) {
    return this.questionsService.create(dto);
  }

  @Get('test/:testId')
  @Roles(UserRole.ADMIN)
  findByTest(@Param('testId', ParseUUIDPipe) testId: string) {
    return this.questionsService.findByTestId(testId);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.questionsService.findById(id);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateQuestionDto) {
    return this.questionsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.questionsService.remove(id);
  }

  @Post(':id/test-cases')
  @Roles(UserRole.ADMIN)
  addTestCase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTestCaseDto,
  ) {
    return this.questionsService.addTestCase(id, dto);
  }

  @Delete('test-cases/:testCaseId')
  @Roles(UserRole.ADMIN)
  removeTestCase(@Param('testCaseId', ParseUUIDPipe) testCaseId: string) {
    return this.questionsService.removeTestCase(testCaseId);
  }
}
