import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import type { AccidentReport } from '../types.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const ACCIDENT_COLUMNS = [
  'id', 'vehicle_id', 'driver_id', 'accident_date', 'description',
  'cost', 'driver_at_fault', 'created_at', 'updated_at',
];

const COLUMNS_SQL = ACCIDENT_COLUMNS.join(', ');

// GET /api/accidents/vehicle/:vehicleId
router.get(
  '/vehicle/:vehicleId',
  requireIdParam('vehicleId'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const reports = await query<AccidentReport>(
      `SELECT ${COLUMNS_SQL} FROM accident_reports WHERE vehicle_id = $1 ORDER BY accident_date DESC LIMIT $2`,
      [req.params.vehicleId, limit]
    );
    res.json(reports);
  })
);

// POST /api/accidents
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['vehicleId', 'accidentDate', 'description', 'cost', 'driverAtFault']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = randomUUID();
    const created = await executeReturning<AccidentReport>(
      `INSERT INTO accident_reports (id, vehicle_id, driver_id, accident_date, description, cost, driver_at_fault)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLUMNS_SQL}`,
      [id, b.vehicleId, b.driverId ?? null, b.accidentDate, b.description, b.cost, b.driverAtFault]
    );
    res.status(201).json(created);
  })
);

// PATCH /api/accidents/:id
router.patch(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (b.accidentDate !== undefined) { updates.push(`accident_date = $${idx++}`); params.push(b.accidentDate); }
    if (b.description !== undefined) { updates.push(`description = $${idx++}`); params.push(b.description); }
    if (b.cost !== undefined) { updates.push(`cost = $${idx++}`); params.push(b.cost); }
    if (b.driverAtFault !== undefined) { updates.push(`driver_at_fault = $${idx++}`); params.push(b.driverAtFault); }
    if (b.driverId !== undefined) { updates.push(`driver_id = $${idx++}`); params.push(b.driverId); }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    updates.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const updated = await executeReturning(
      `UPDATE accident_reports SET ${updates.join(', ')} WHERE id = $${idx} RETURNING ${COLUMNS_SQL}`,
      params
    );
    if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(updated);
  })
);

// DELETE /api/accidents/:id
router.delete(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    await execute(`DELETE FROM accident_reports WHERE id = $1`, [req.params.id]);
    res.status(204).send();
  })
);

export default router;
