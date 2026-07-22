import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import type { TyreLog } from '../types.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const ALLOWED_POSITIONS = ['FL', 'FR', 'RL', 'RR', 'SPARE'];

const TYRE_COLUMNS = [
  'id', 'vehicle_id', 'position', 'install_date', 'replacement_date',
  'brand', 'cost', 'created_at', 'updated_at',
];

const COLUMNS_SQL = TYRE_COLUMNS.join(', ');

// GET /api/tyres/vehicle/:vehicleId
router.get(
  '/vehicle/:vehicleId',
  requireIdParam('vehicleId'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const logs = await query<TyreLog>(
      `SELECT ${COLUMNS_SQL} FROM tyre_logs WHERE vehicle_id = $1 ORDER BY install_date DESC LIMIT $2`,
      [req.params.vehicleId, limit]
    );
    res.json(logs);
  })
);

// POST /api/tyres
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['vehicleId', 'position', 'installDate', 'brand', 'cost']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    if (!ALLOWED_POSITIONS.includes(b.position)) {
      res.status(400).json({ error: `position must be one of: ${ALLOWED_POSITIONS.join(', ')}` });
      return;
    }
    const id = randomUUID();
    const created = await executeReturning<TyreLog>(
      `INSERT INTO tyre_logs (id, vehicle_id, position, install_date, replacement_date, brand, cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLUMNS_SQL}`,
      [id, b.vehicleId, b.position, b.installDate, b.replacementDate ?? null, b.brand, b.cost]
    );
    res.status(201).json(created);
  })
);

// PATCH /api/tyres/:id
router.patch(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (b.position !== undefined) {
      if (!ALLOWED_POSITIONS.includes(b.position)) {
        res.status(400).json({ error: `position must be one of: ${ALLOWED_POSITIONS.join(', ')}` });
        return;
      }
      updates.push(`position = $${idx++}`); params.push(b.position);
    }
    if (b.installDate !== undefined) { updates.push(`install_date = $${idx++}`); params.push(b.installDate); }
    if (b.replacementDate !== undefined) { updates.push(`replacement_date = $${idx++}`); params.push(b.replacementDate); }
    if (b.brand !== undefined) { updates.push(`brand = $${idx++}`); params.push(b.brand); }
    if (b.cost !== undefined) { updates.push(`cost = $${idx++}`); params.push(b.cost); }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    updates.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const updated = await executeReturning(
      `UPDATE tyre_logs SET ${updates.join(', ')} WHERE id = $${idx} RETURNING ${COLUMNS_SQL}`,
      params
    );
    if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(updated);
  })
);

// DELETE /api/tyres/:id
router.delete(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    await execute(`DELETE FROM tyre_logs WHERE id = $1`, [req.params.id]);
    res.status(204).send();
  })
);

export default router;
