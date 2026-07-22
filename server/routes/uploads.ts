import { Router } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { asyncHandler } from '../validate.js';
import { requireAuth } from '../auth.js';
import { storageService, StorageValidationError, type UploadKind } from '../storage/storage.service.js';

const router = Router();
router.use(requireAuth);

const VALID_KINDS: UploadKind[] = ['photo', 'avatar', 'document'];

// ── MinIO presigned upload ─────────────────────────────────────────────────
/**
 * POST /api/uploads/presign
 *
 * Two-step upload pattern: the server validates the request and hands back a
 * short-lived presigned URL; the browser then PUTs the raw file directly to
 * that URL.
 *
 * body: { kind: 'photo' | 'avatar' | 'document', fileName: string, contentType: string, sizeBytes?: number }
 */
router.post(
  '/presign',
  asyncHandler(async (req, res) => {
    const { kind, fileName, contentType, sizeBytes } = req.body ?? {};

    if (!VALID_KINDS.includes(kind)) {
      res.status(400).json({ error: `kind must be one of: ${VALID_KINDS.join(', ')}` });
      return;
    }
    if (!fileName || typeof fileName !== 'string') {
      res.status(400).json({ error: 'fileName is required' });
      return;
    }
    if (!contentType || typeof contentType !== 'string') {
      res.status(400).json({ error: 'contentType is required' });
      return;
    }

    try {
      const result = await storageService.presignUpload({
        kind,
        fileName,
        contentType,
        sizeBytes: typeof sizeBytes === 'number' ? sizeBytes : undefined,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof StorageValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  })
);

// ── Cloudinary signed upload ───────────────────────────────────────────────
/**
 * POST /api/uploads/cloudinary-signature
 *
 * Two-step signed upload: (1) server generates a signature using the API secret
 * (which never leaves the server), (2) the browser POSTs the file bytes
 * straight to Cloudinary's upload API using the signature. The browser receives
 * a `secure_url` which is stored in the database as the image URL.
 *
 * body: { folder?: string }
 */
router.post(
  '/cloudinary-signature',
  asyncHandler(async (req, res) => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      res.status(500).json({ error: 'Cloudinary is not configured on the server. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in .env' });
      return;
    }

    const folder = (req.body?.folder as string) || 'fleet-photos';
    const timestamp = Math.floor(Date.now() / 1000);

    // Cloudinary signature = SHA1(sorted params + api_secret)
    // Only include `folder` and `timestamp` in the signature (whitelist approach)
    const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
    const signature = createHash('sha1')
      .update(paramsToSign + apiSecret)
      .digest('hex');

    res.json({
      cloudName,
      apiKey,
      timestamp,
      folder,
      signature,
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    });
  })
);

export default router;
