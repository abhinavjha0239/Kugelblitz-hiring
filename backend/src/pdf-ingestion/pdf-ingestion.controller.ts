import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import * as fs from 'fs';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PdfIngestionService } from './pdf-ingestion.service';
import { ConfirmPdfUploadDto } from './dto/confirm-pdf-upload.dto';

const uploadRoot = join(process.cwd(), 'uploads', 'pdf-imports');
if (!fs.existsSync(uploadRoot)) fs.mkdirSync(uploadRoot, { recursive: true });

@Controller('admin/questions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PdfIngestionController {
  constructor(private readonly ingestionService: PdfIngestionService) {}

  @Post('upload-pdf')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (
          _req: Request,
          _file: Express.Multer.File,
          cb: (error: Error | null, destination: string) => void,
        ) => cb(null, uploadRoot),
        filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
          const safe = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname)}`;
          cb(null, safe);
        },
      }),
      limits: { fileSize: 15 * 1024 * 1024 },
      fileFilter: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, acceptFile: boolean) => void) => {
        if (!file.originalname.toLowerCase().endsWith('.pdf')) {
          cb(new Error('Only PDF files are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadPdf(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
  ) {
    const upload = await this.ingestionService.createUpload(file.originalname, file.path, userId);
    return {
      uploadId: upload.id,
      status: upload.status,
      progress: upload.progress,
      message: 'PDF uploaded. Processing started.',
    };
  }

  @Get('upload-pdf/:uploadId')
  async getUploadStatus(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.ingestionService.getUpload(uploadId, userId);
  }

  @Post('confirm-upload')
  async confirmUpload(
    @Body() dto: ConfirmPdfUploadDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.ingestionService.confirmUpload(userId, dto);
  }
}
