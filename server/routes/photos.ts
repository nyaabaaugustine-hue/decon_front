import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import type { VehiclePhoto } from '../types.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const PHOTO_COLUMNS = [
  'id', 'vehicle_id', 'category', 'caption', 'taken_at',
  'image_url', 'created_at', 'updated_at',
];

const COLUMNS_SQL = PHOTO_COLUMNS.join(', ');

// GET /api/photos/vehicle/:vehicleId
router.get(
  '/vehicle/:vehicleId',
  requireIdParam('vehicleId'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const photos = await query<VehiclePhoto>(
      `SELECT ${COLUMNS_SQL} FROM vehicle_photos WHERE vehicle_id = $1 ORDER BY taken_at DESC LIMIT $2`,
      [req.params.vehicleId, limit]
    );
    res.json(photos);
  })
);

// POST /api/photos
// The client uploads the binary directly to Cloudinary (via the signed params from
// POST /api/uploads/cloudinary-signature) and then sends the resulting secure_url here
// as `imageUrl`, which this endpoint stores alongside the category/caption/date metadata.
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['vehicleId', 'category', 'caption', 'takenAt', 'imageUrl']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = randomUUID();
    const created = await executeReturning<VehiclePhoto>(
      `INSERT INTO vehicle_photos (id, vehicle_id, category, caption, taken_at, image_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNS_SQL}`,
      [id, b.vehicleId, b.category, b.caption, b.takenAt, b.imageUrl]
    );
    res.status(201).json(created);
  })
);

// PATCH /api/photos/:id
router.patch(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (b.category !== undefined) { updates.push(`category = $${idx++}`); params.push(b.category); }
    if (b.caption !== undefined) { updates.push(`caption = $${idx++}`); params.push(b.caption); }
    if (b.takenAt !== undefined) { updates.push(`taken_at = $${idx++}`); params.push(b.takenAt); }
    if (b.imageUrl !== undefined) { updates.push(`image_url = $${idx++}`); params.push(b.imageUrl); }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    updates.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const updated = await executeReturning(
      `UPDATE vehicle_photos SET ${updates.join(', ')} WHERE id = $${idx} RETURNING ${COLUMNS_SQL}`,
      params
    );
    if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(updated);
  })
);

// DELETE /api/photos/:id
router.delete(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    await execute(`DELETE FROM vehicle_photos WHERE id = $1`, [req.params.id]);
    res.status(204).send();
  })
);

export default router;
