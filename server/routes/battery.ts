import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import type { BatteryLog } from '../types.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const BATTERY_COLUMNS = [
  'id', 'vehicle_id', 'install_date', 'replacement_date',
  'brand', 'supplier', 'cost', 'created_at', 'updated_at',
];

const COLUMNS_SQL = BATTERY_COLUMNS.join(', ');

// GET /api/battery/vehicle/:vehicleId
router.get(
  '/vehicle/:vehicleId',
  requireIdParam('vehicleId'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const logs = await query<BatteryLog>(
      `SELECT ${COLUMNS_SQL} FROM battery_logs WHERE vehicle_id = $1 ORDER BY install_date DESC LIMIT $2`,
      [req.params.vehicleId, limit]
    );
    res.json(logs);
  })
);

// POST /api/battery
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['vehicleId', 'installDate', 'brand', 'supplier', 'cost']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = randomUUID();
    const created = await executeReturning<BatteryLog>(
      `INSERT INTO battery_logs (id, vehicle_id, install_date, replacement_date, brand, supplier, cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLUMNS_SQL}`,
      [id, b.vehicleId, b.installDate, b.replacementDate ?? null, b.brand, b.supplier, b.cost]
    );
    res.status(201).json(created);
  })
);

// PATCH /api/battery/:id
router.patch(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (b.installDate !== undefined) { updates.push(`install_date = $${idx++}`); params.push(b.installDate); }
    if (b.replacementDate !== undefined) { updates.push(`replacement_date = $${idx++}`); params.push(b.replacementDate); }
    if (b.brand !== undefined) { updates.push(`brand = $${idx++}`); params.push(b.brand); }
    if (b.supplier !== undefined) { updates.push(`supplier = $${idx++}`); params.push(b.supplier); }
    if (b.cost !== undefined) { updates.push(`cost = $${idx++}`); params.push(b.cost); }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    updates.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const updated = await executeReturning(
      `UPDATE battery_logs SET ${updates.join(', ')} WHERE id = $${idx} RETURNING ${COLUMNS_SQL}`,
      params
    );
    if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(updated);
  })
);

// DELETE /api/battery/:id
router.delete(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    await execute(`DELETE FROM battery_logs WHERE id = $1`, [req.params.id]);
    res.status(204).send();
  })
);

export default router;
