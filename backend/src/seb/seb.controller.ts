import {
  Controller,
  Get,
  Post,
  Param,
  Res,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UseGuards,
  Req,
  SetMetadata,
} from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { SebService } from './seb.service';
import { Test } from '../tests/test.entity';
import { MagicLink } from '../magic-link/magic-link.entity';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../users/user.entity';

@Controller()
export class SebController {
  constructor(
    private readonly sebService: SebService,
    @InjectRepository(Test) private testsRepo: Repository<Test>,
    @InjectRepository(MagicLink) private linksRepo: Repository<MagicLink>,
    private readonly config: ConfigService,
  ) {}

  // Public — token IS the credential. Must NOT be JWT-guarded (the candidate
  // doesn't yet have a JWT when they download the .seb).
  @Get('exam/:token/seb-config')
  @SetMetadata('isPublic', true)
  async candidateSebConfig(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    const link = await this.linksRepo.findOne({
      where: { token },
      relations: ['test'],
    });
    if (!link || !link.test) throw new NotFoundException('Invalid link');
    if (!link.test.requireSafeExamBrowser) {
      throw new BadRequestException('This exam does not require Safe Exam Browser');
    }
    await this.sebService.ensureLinkBek(link);
    const buf = this.sebService.buildSebConfig({
      test: link.test,
      link,
      appBaseUrl: this.appBaseUrl,
    });
    const fname = `exam-${token.slice(0, 12)}.seb`;
    res
      .header('Content-Type', 'application/seb')
      .header('Content-Disposition', `attachment; filename="${fname}"`)
      .header('Cache-Control', 'no-store, no-cache, must-revalidate')
      .header('Pragma', 'no-cache')
      .send(buf);
  }

  // Admin-only preview — generates a .seb with a synthetic BEK so the admin
  // can verify the prohibited-processes / lockdown flags without burning a
  // candidate's BEK.
  @Get('admin/tests/:testId/seb-config-preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminPreview(@Param('testId') testId: string, @Res() res: Response) {
    const test = await this.testsRepo.findOne({ where: { id: testId } });
    if (!test) throw new NotFoundException('Test not found');
    // Synthetic 32-byte hex BEK + salt so the preview .seb is structurally
    // identical to a real candidate's file. Buffer.from(...,'hex') needs
    // valid hex for both — a free-form prefix would silently be truncated
    // and SEB would reject the file.
    const fakeLink: any = {
      token: 'preview' + crypto.randomBytes(28).toString('hex'),
      sebBrowserExamKey: crypto.randomBytes(32).toString('hex'),
      sebExamKeySalt: crypto.randomBytes(32).toString('hex'),
    };
    const buf = this.sebService.buildSebConfig({
      test,
      link: fakeLink,
      appBaseUrl: this.appBaseUrl,
    });
    res
      .header('Content-Type', 'application/seb')
      .header('Content-Disposition', `attachment; filename="preview-${test.id.slice(0, 8)}.seb"`)
      .send(buf);
  }

  // Called from inside SEB after the magic-link login. JWT-guarded — by this
  // point the candidate has logged in via /api/auth/magic/:token. Verifies
  // the SEB header and confirms the session is valid before letting the
  // frontend render the test.
  @Post('seb/preflight')
  @UseGuards(JwtAuthGuard)
  async preflight(@Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException('Not authenticated');
    const link = await this.linksRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    if (!link?.sebBrowserExamKey) {
      throw new ForbiddenException('No SEB session — open the .seb config from your invite email');
    }
    if (!this.sebService.verifyRequestHash(req, link.sebBrowserExamKey, link.sebExamKeySalt)) {
      throw new ForbiddenException('SEB header missing or invalid');
    }
    return { ok: true, testId: link.testId };
  }

  private get appBaseUrl(): string {
    return (
      this.config.get<string>('APP_BASE_URL') ||
      this.config.get<string>('app.baseUrl') ||
      'http://localhost:3000'
    );
  }
}
