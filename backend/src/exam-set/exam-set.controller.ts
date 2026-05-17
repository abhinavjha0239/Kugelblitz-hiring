import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ExamSetService } from './exam-set.service';
import { CreateSetDto, UpdateSetDto } from './dto/exam-set.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ExamSetController {
  constructor(private readonly service: ExamSetService) {}

  @Get('tests/:testId/sets')
  list(@Param('testId', ParseUUIDPipe) testId: string) {
    return this.service.list(testId);
  }

  @Post('tests/:testId/sets')
  create(@Param('testId', ParseUUIDPipe) testId: string, @Body() dto: CreateSetDto) {
    return this.service.create(testId, dto);
  }

  @Put('sets/:setId')
  update(@Param('setId', ParseUUIDPipe) setId: string, @Body() dto: UpdateSetDto) {
    return this.service.update(setId, dto);
  }

  @Delete('sets/:setId')
  remove(@Param('setId', ParseUUIDPipe) setId: string) {
    return this.service.remove(setId);
  }
}
