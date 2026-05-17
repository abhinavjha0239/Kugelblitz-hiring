import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as fileType from 'file-type';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';
import { StorageService } from './storage.service';

const CLAIMED_MIME = /^image\/(png|jpe?g|webp|gif)$/i;
const ACTUAL_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const MAX = 5 * 1024 * 1024; // 5 MB

@Controller('uploads')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class UploadsController {
  constructor(private readonly storage: StorageService) {}

  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      // Memory storage so we can magic-byte-validate the buffer BEFORE handing
      // it to GCS. Disk storage was leaving rejected files on the FS for
      // background cleanup; with the buffer the rejection is total.
      storage: memoryStorage(),
      limits: { fileSize: MAX },
      fileFilter: (_req, file, cb) => {
        if (!CLAIMED_MIME.test(file.mimetype)) {
          return cb(new BadRequestException('Only PNG/JPEG/WEBP/GIF images allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer) throw new BadRequestException('No file');

    // Strict magic-byte validation: peek the buffer, ensure it actually IS
    // one of our claimed formats. Defends against polyglot files (a valid
    // image header followed by malicious payload bytes); GCS will serve the
    // file as the *detected* MIME below, so a polyglot can't trick the
    // browser into running JS via Content-Type sniffing.
    const detected: { ext?: string; mime?: string } | undefined = await (fileType as any)
      .fromBuffer(file.buffer)
      .catch(() => undefined);

    if (!detected || !detected.ext || !ACTUAL_EXT.has(detected.ext)) {
      throw new BadRequestException(
        'File is not a valid image. Magic bytes do not match PNG/JPEG/WEBP/GIF.',
      );
    }

    // Normalize jpeg → jpg in the stored extension; mime stays image/jpeg.
    const normalizedExt = detected.ext === 'jpeg' ? 'jpg' : detected.ext;

    const result = await this.storage.upload({
      buffer: file.buffer,
      ext: normalizedExt,
      mimetype: detected.mime || file.mimetype,
    });

    return {
      id: result.id,
      url: result.url,
      size: result.size,
      mimetype: result.mimetype,
      detectedExt: detected.ext,
    };
  }
}
