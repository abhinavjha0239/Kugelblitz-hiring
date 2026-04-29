import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { TestsService } from './tests.service';
import { CreateTestDto, UpdateTestDto } from './dto/create-test.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../users/user.entity';

@Controller('tests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TestsController {
  constructor(private testsService: TestsService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateTestDto, @CurrentUser('id') userId: string) {
    return this.testsService.create(dto, userId);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.testsService.findAll(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('active')
  findActiveTests() {
    return this.testsService.findActiveTests();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    if (user.role === UserRole.ADMIN) {
      return this.testsService.findById(id);
    }
    return this.testsService.findByIdForStudent(id);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTestDto) {
    return this.testsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.testsService.remove(id);
  }
}
