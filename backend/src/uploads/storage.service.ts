import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage, Bucket } from '@google-cloud/storage';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export interface UploadResult {
  /** Stable id (UUID without extension) — usable for later delete. */
  id: string;
  /** Absolute or app-relative URL the browser can fetch. */
  url: string;
  /** Server-side object path / disk path — used for delete(). */
  storageKey: string;
  size: number;
  mimetype: string;
}

/**
 * Two-backend storage abstraction:
 *
 *   - GCS  → when GCS_BUCKET env is set. Uses Application Default Credentials
 *            (the VM's attached service account in prod; `gcloud auth
 *            application-default login` for local dev). Objects are public-read
 *            (bucket-level IAM grants `allUsers` viewer), so the returned URL
 *            is the standard `https://storage.googleapis.com/<bucket>/<key>`.
 *   - DISK → when GCS_BUCKET is unset. Writes to ./uploads relative to CWD;
 *            served by ServeStaticModule at /api/uploads.
 *
 * The controller doesn't know which backend is active — it just calls
 * upload(buffer, ext, mimetype, prefix?) and gets back a URL.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private bucketName: string | null = null;
  private bucket: Bucket | null = null;
  private localBaseDir = path.join(process.cwd(), 'uploads');
  private localUrlBase = '/api/uploads';

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.bucketName = this.config.get<string>('GCS_BUCKET') || null;
    if (this.bucketName) {
      const storage = new Storage({
        projectId: this.config.get<string>('GCS_PROJECT_ID') || undefined,
      });
      this.bucket = storage.bucket(this.bucketName);
      // Note: we don't probe the bucket here because objectAdmin doesn't grant
      // buckets.get — and that's the right permission scoping. If the bucket
      // is misconfigured, the first upload will fail loudly with a clear
      // error; that's preferable to needing an extra IAM role just to boot.
      this.logger.log(`Storage backend: GCS bucket gs://${this.bucketName}`);
    }
    if (!this.bucket) {
      // Ensure local upload dirs exist
      try {
        fs.mkdirSync(path.join(this.localBaseDir, 'images'), { recursive: true });
      } catch { /* already exists */ }
      this.logger.log(`Storage backend: local disk at ${this.localBaseDir}`);
    }
  }

  /**
   * Upload a buffer. Returns a public URL the browser can fetch.
   *
   * Bulletproofing:
   * - File name is a fresh UUID — original filename is never trusted.
   * - GCS object's content-type is set explicitly (not inferred from name) so
   *   a mislabeled .png with text bytes doesn't get served as HTML / executed.
   * - cacheControl set to 1y immutable since UUIDs never collide.
   * - Three retries on transient GCS failures (the SDK does some itself; we
   *   wrap with our own retry for clarity).
   */
  async upload(input: {
    buffer: Buffer;
    ext: string; // e.g. 'png'
    mimetype: string;
    prefix?: string; // 'images' (default) or 'temp', etc.
  }): Promise<UploadResult> {
    const id = randomUUID();
    const cleanExt = input.ext.replace(/^\.+/, '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const filename = `${id}.${cleanExt}`;
    const prefix = (input.prefix || 'images').replace(/[^a-z0-9-]/gi, '');
    const storageKey = `${prefix}/${filename}`;

    if (this.bucket) {
      // ─── GCS path ──────────────────────────────────────────
      const file = this.bucket.file(storageKey);
      let lastErr: any = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await file.save(input.buffer, {
            metadata: {
              contentType: input.mimetype,
              cacheControl: 'public, max-age=31536000, immutable',
              // Custom metadata kept under metadata.metadata per GCS schema
              metadata: { uploadedAt: new Date().toISOString() },
            },
            resumable: false, // single-shot for files <5 MB
            validation: 'crc32c', // catch corruption in transit
          });
          // Bucket-level IAM grants public read; no per-object ACL needed.
          return {
            id,
            url: `https://storage.googleapis.com/${this.bucketName}/${storageKey}`,
            storageKey,
            size: input.buffer.length,
            mimetype: input.mimetype,
          };
        } catch (err: any) {
          lastErr = err;
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
          }
        }
      }
      throw new Error(`GCS upload failed after 3 attempts: ${lastErr?.message || 'unknown'}`);
    }

    // ─── Local disk path ─────────────────────────────────────
    const dir = path.join(this.localBaseDir, prefix);
    fs.mkdirSync(dir, { recursive: true });
    const onDiskPath = path.join(dir, filename);
    fs.writeFileSync(onDiskPath, input.buffer);
    return {
      id,
      url: `${this.localUrlBase}/${prefix}/${filename}`,
      storageKey,
      size: input.buffer.length,
      mimetype: input.mimetype,
    };
  }

  /**
   * Delete by storage key. Idempotent — missing object is not an error.
   * Used for orphan cleanup when a question is deleted.
   */
  async delete(storageKey: string): Promise<void> {
    if (!storageKey) return;
    if (this.bucket) {
      try {
        await this.bucket.file(storageKey).delete({ ignoreNotFound: true });
      } catch (err: any) {
        this.logger.warn(`GCS delete failed for ${storageKey}: ${err.message}`);
      }
      return;
    }
    const onDisk = path.join(this.localBaseDir, storageKey);
    try {
      fs.unlinkSync(onDisk);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        this.logger.warn(`Disk delete failed for ${onDisk}: ${err.message}`);
      }
    }
  }

  /** True if running against a real GCS bucket. */
  isCloud(): boolean {
    return this.bucket !== null;
  }
}
