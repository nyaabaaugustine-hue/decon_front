import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import type { VehicleDocument } from '../types.js';
import { requireAuth, requireRole } from '../auth.js';
import { storageService, DOCUMENTS_BUCKET, PHOTOS_BUCKET } from '../storage/storage.service.js';

const router = Router();
router.use(requireAuth);

const ALLOWED_DOC_TYPES = [
  'purchase_invoice',
  'insurance_policy',
  'registration_certificate',
  'receipt',
  'report',
  'other',
];

const DOCUMENT_COLUMNS = [
  'id', 'vehicle_id', 'doc_type', 'file_name', 'issue_date',
  'expiry_date', 'notes', 'object_key', 'bucket', 'mime_type', 'file_size',
  'created_at', 'updated_at',
];

const COLUMNS_SQL = DOCUMENT_COLUMNS.join(', ');

// GET /api/documents/vehicle/:vehicleId
router.get(
  '/vehicle/:vehicleId',
  requireIdParam('vehicleId'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const docs = await query<VehicleDocument>(
      `SELECT ${COLUMNS_SQL} FROM vehicle_documents WHERE vehicle_id = $1 ORDER BY issue_date DESC LIMIT $2`,
      [req.params.vehicleId, limit]
    );
    res.json(docs);
  })
);

// GET /api/documents/:id/url
// Returns a short-lived signed URL to view/download the actual uploaded file.
// Kept as a separate endpoint (rather than a durable stored URL) because the
// documents bucket is private — every request gets a fresh, time-limited link.
router.get(
  '/:id/url',
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const doc = await queryOne<{ object_key: string | null; bucket: string | null; file_name: string }>(
      `SELECT object_key, bucket, file_name FROM vehicle_documents WHERE id = $1`,
      [req.params.id]
    );
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    if (!doc.object_key) {
      res.status(404).json({ error: 'This document has no uploaded file on record' });
      return;
    }
    const url = await storageService.presignDownload(doc.bucket || DOCUMENTS_BUCKET, doc.object_key, 300);
    res.json({ url, fileName: doc.file_name, expiresIn: 300 });
  })
);

// POST /api/documents
// Client uploads the file to MinIO first via POST /api/uploads/presign (kind:
// 'document'), then calls this endpoint with the resulting objectKey/bucket
// plus the document metadata.
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['vehicleId', 'docType', 'fileName', 'issueDate']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    if (!ALLOWED_DOC_TYPES.includes(b.docType)) {
      res.status(400).json({ error: `docType must be one of: ${ALLOWED_DOC_TYPES.join(', ')}` });
      return;
    }
    const id = randomUUID();
    const created = await executeReturning<VehicleDocument>(
      `INSERT INTO vehicle_documents (id, vehicle_id, doc_type, file_name, issue_date, expiry_date, notes, object_key, bucket, mime_type, file_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${COLUMNS_SQL}`,
      [
        id,
        b.vehicleId,
        b.docType,
        b.fileName,
        b.issueDate,
        b.expiryDate ?? null,
        b.notes ?? null,
        b.objectKey ?? null,
        b.bucket ?? null,
        b.mimeType ?? null,
        b.fileSize ?? null,
      ]
    );
    res.status(201).json(created);
  })
);

// PATCH /api/documents/:id — update metadata only (no file re-upload)
router.patch(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (b.docType !== undefined) {
      if (!ALLOWED_DOC_TYPES.includes(b.docType)) {
        res.status(400).json({ error: `docType must be one of: ${ALLOWED_DOC_TYPES.join(', ')}` });
        return;
      }
      updates.push(`doc_type = $${idx++}`); params.push(b.docType);
    }
    if (b.fileName !== undefined) { updates.push(`file_name = $${idx++}`); params.push(b.fileName); }
    if (b.issueDate !== undefined) { updates.push(`issue_date = $${idx++}`); params.push(b.issueDate); }
    if (b.expiryDate !== undefined) { updates.push(`expiry_date = $${idx++}`); params.push(b.expiryDate); }
    if (b.notes !== undefined) { updates.push(`notes = $${idx++}`); params.push(b.notes); }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    updates.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const updated = await executeReturning(
      `UPDATE vehicle_documents SET ${updates.join(', ')} WHERE id = $${idx} RETURNING ${COLUMNS_SQL}`,
      params
    );
    if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(updated);
  })
);

// DELETE /api/documents/:id — also removes the underlying file from storage
router.delete(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const doc = await queryOne<{ object_key: string | null; bucket: string | null }>(
      `SELECT object_key, bucket FROM vehicle_documents WHERE id = $1`,
      [req.params.id]
    );
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    await execute(`DELETE FROM vehicle_documents WHERE id = $1`, [req.params.id]);
    if (doc.object_key) {
      // Best-effort — a dangling object in storage is a minor cleanup issue,
      // not worth failing the whole delete over if this call errors.
      storageService.deleteObject(doc.bucket || DOCUMENTS_BUCKET, doc.object_key).catch((err) => {
        console.error('Failed to delete document object from storage:', err.message);
      });
    }
    res.status(204).send();
  })
);

export default router;
