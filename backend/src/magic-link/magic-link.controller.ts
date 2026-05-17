import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { MagicLinkService } from './magic-link.service';
import { CompleteProfileDto, CreateInvitesDto } from './dto/magic-link.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';

@Controller()
export class MagicLinkController {
  constructor(private readonly service: MagicLinkService) {}

  // ── Admin endpoints ─────────────────────────────────────
  @Post('admin/tests/:testId/invites')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  createBulk(
    @Param('testId', ParseUUIDPipe) testId: string,
    @Body() dto: CreateInvitesDto,
  ) {
    return this.service.createBulk(testId, dto.rows);
  }

  @Get('admin/tests/:testId/invites')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  list(@Param('testId', ParseUUIDPipe) testId: string) {
    return this.service.listByTest(testId);
  }

  @Get('admin/mail-queue/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  queueStats() {
    return this.service.getMailQueueStats();
  }

  @Post('admin/invites/:inviteId/resend')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  resend(@Param('inviteId', ParseUUIDPipe) inviteId: string) {
    return this.service.resend(inviteId);
  }

  @Delete('admin/invites/:inviteId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  revoke(@Param('inviteId', ParseUUIDPipe) inviteId: string) {
    return this.service.revoke(inviteId);
  }

  // ── Public candidate endpoints (no JWT yet) ─────────────
  @Post('auth/magic/:token')
  @SetMetadata('isPublic', true)
  async magicLogin(@Param('token') token: string) {
    const v = await this.service.validateAndConsume(token);
    return {
      accessToken: v.accessToken,
      user: {
        id: v.user.id,
        email: v.user.email,
        firstName: v.user.firstName,
        lastName: v.user.lastName,
        mobile: v.user.mobile,
        role: v.user.role,
      },
      testId: v.test.id,
      testTitle: v.test.title,
      requireSafeExamBrowser: !!v.test.requireSafeExamBrowser,
      profileComplete: v.profileComplete,
      // Locks this session to a single test on the frontend (soft redirect).
      // The hard gate is the InviteScopeGuard reading the same claim from
      // the JWT — see backend/src/common/guards/invite-scope.guard.ts.
      inviteScope: v.inviteScope,
    };
  }

  @Post('auth/magic/:token/profile')
  @SetMetadata('isPublic', true)
  async completeProfile(
    @Param('token') token: string,
    @Body() dto: CompleteProfileDto,
  ) {
    const user = await this.service.completeProfile(token, dto);
    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        mobile: user.mobile,
        role: user.role,
      },
      profileComplete: true,
    };
  }
}
