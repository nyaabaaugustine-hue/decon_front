import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import type { RevenueEntry } from '../types.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const REVENUE_COLUMNS = [
  'id', 'vehicle_id', 'driver_id', 'trip_date', 'trip_reference',
  'route', 'client', 'amount', 'created_at', 'updated_at',
];

const COLUMNS_SQL = REVENUE_COLUMNS.join(', ');

// GET /api/revenue/vehicle/:vehicleId
router.get(
  '/vehicle/:vehicleId',
  requireIdParam('vehicleId'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const entries = await query<RevenueEntry>(
      `SELECT ${COLUMNS_SQL} FROM revenue_entries WHERE vehicle_id = $1 ORDER BY trip_date DESC LIMIT $2`,
      [req.params.vehicleId, limit]
    );
    res.json(entries);
  })
);

// POST /api/revenue
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['vehicleId', 'driverId', 'tripDate', 'tripReference', 'route', 'client', 'amount']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = randomUUID();
    const created = await executeReturning<RevenueEntry>(
      `INSERT INTO revenue_entries (id, vehicle_id, driver_id, trip_date, trip_reference, route, client, amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COLUMNS_SQL}`,
      [id, b.vehicleId, b.driverId, b.tripDate, b.tripReference, b.route, b.client, b.amount]
    );
    res.status(201).json(created);
  })
);

// PATCH /api/revenue/:id
router.patch(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (b.tripDate !== undefined) { updates.push(`trip_date = $${idx++}`); params.push(b.tripDate); }
    if (b.tripReference !== undefined) { updates.push(`trip_reference = $${idx++}`); params.push(b.tripReference); }
    if (b.route !== undefined) { updates.push(`route = $${idx++}`); params.push(b.route); }
    if (b.client !== undefined) { updates.push(`client = $${idx++}`); params.push(b.client); }
    if (b.amount !== undefined) { updates.push(`amount = $${idx++}`); params.push(b.amount); }
    if (b.driverId !== undefined) { updates.push(`driver_id = $${idx++}`); params.push(b.driverId); }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    updates.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const updated = await executeReturning(
      `UPDATE revenue_entries SET ${updates.join(', ')} WHERE id = $${idx} RETURNING ${COLUMNS_SQL}`,
      params
    );
    if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(updated);
  })
);

// DELETE /api/revenue/:id
router.delete(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    await execute(`DELETE FROM revenue_entries WHERE id = $1`, [req.params.id]);
    res.status(204).send();
  })
);

export default router;
