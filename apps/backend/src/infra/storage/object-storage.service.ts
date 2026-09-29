import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Env } from '../../config/env.validation';

/**
 * Where uploaded files (stop photos, proof of delivery) are kept. In
 * production that is the private S3 bucket named by UPLOADS_BUCKET,
 * encrypted and versioned (Deployment plan; Technology Stack §05) — never a
 * server's own disk, which a replaced container loses and a second API
 * server can't see (Performance Audit PA-13). Without a bucket, files go to
 * UPLOADS_DIR on local disk, for development.
 *
 * Keys always use '/' so a key written on one OS reads the same on another.
 */
@Injectable()
export class ObjectStorageService {
  private readonly bucket: string | undefined;
  private readonly s3: S3Client | undefined;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.bucket = config.get('UPLOADS_BUCKET', { infer: true });
    // Credentials come from the ECS task role; nothing to configure here.
    if (this.bucket) this.s3 = new S3Client({ region: config.get('AWS_REGION', { infer: true }) });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.s3 && this.bucket) {
      await this.s3.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'aws:kms' }),
      );
      return;
    }
    const absolute = path.join(this.config.get('UPLOADS_DIR', { infer: true }), ...key.split('/'));
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, body);
  }
}
