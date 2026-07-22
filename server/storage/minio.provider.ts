import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageProvider, PresignedUpload } from './storage.interface.js';

// ── Configuration ──────────────────────────────────────────────────────────────
// MinIO speaks the S3 API, so the standard AWS SDK works against it — we just
// point `endpoint` at the MinIO server and set `forcePathStyle: true` (MinIO
// doesn't support the virtual-hosted-style bucket URLs AWS defaults to).

const endpoint = process.env.MINIO_ENDPOINT || '';
const accessKeyId = process.env.MINIO_ACCESS_KEY || '';
const secretAccessKey = process.env.MINIO_SECRET_KEY || '';
// MinIO ignores the region value but the SDK requires one to be set.
const region = process.env.MINIO_REGION || 'us-east-1';
// Only relevant for the publicUrl() helper (public-read photo/avatar bucket).
// Falls back to the API endpoint itself if a separate public/CDN host isn't set.
const publicBaseUrl = (process.env.MINIO_PUBLIC_URL || endpoint).replace(/\/$/, '');

if (!endpoint || !accessKeyId || !secretAccessKey) {
  console.warn(
    '[storage] MINIO_ENDPOINT / MINIO_ACCESS_KEY / MINIO_SECRET_KEY not fully set — ' +
    'file upload/download endpoints will fail until these are configured in .env.'
  );
}

const s3 = new S3Client({
  endpoint,
  region,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
});

export const minioProvider: StorageProvider = {
  async presignUpload(bucket, objectKey, contentType, expiresInSeconds = 300): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
    return { uploadUrl, objectKey, bucket, expiresIn: expiresInSeconds };
  },

  async presignDownload(bucket, objectKey, expiresInSeconds = 300): Promise<string> {
    const command = new GetObjectCommand({ Bucket: bucket, Key: objectKey });
    return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
  },

  publicUrl(bucket, objectKey): string {
    return `${publicBaseUrl}/${bucket}/${objectKey}`;
  },

  async deleteObject(bucket, objectKey): Promise<void> {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
  },

  async objectExists(bucket, objectKey): Promise<boolean> {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
      return true;
    } catch {
      return false;
    }
  },
};
