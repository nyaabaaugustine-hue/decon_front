import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import type { ServiceLog } from '../types.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const SERVICE_COLUMNS = [
  'id', 'vehicle_id', 'service_date', 'mileage_km', 'service_type',
  'parts_replaced', 'workshop', 'cost', 'created_at', 'updated_at',
];

const COLUMNS_SQL = SERVICE_COLUMNS.join(', ');

// GET /api/services/vehicle/:vehicleId
router.get(
  '/vehicle/:vehicleId',
  requireIdParam('vehicleId'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const logs = await query<ServiceLog>(
      `SELECT ${COLUMNS_SQL} FROM service_logs WHERE vehicle_id = $1 ORDER BY service_date DESC LIMIT $2`,
      [req.params.vehicleId, limit]
    );
    res.json(logs);
  })
);

// POST /api/services
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['vehicleId', 'serviceDate', 'mileageKm', 'serviceType', 'partsReplaced', 'workshop', 'cost']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = randomUUID();
    const created = await executeReturning<ServiceLog>(
      `INSERT INTO service_logs (id, vehicle_id, service_date, mileage_km, service_type, parts_replaced, workshop, cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COLUMNS_SQL}`,
      [id, b.vehicleId, b.serviceDate, b.mileageKm, b.serviceType, b.partsReplaced, b.workshop, b.cost]
    );
    res.status(201).json(created);
  })
);

// PATCH /api/services/:id
router.patch(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (b.serviceDate !== undefined) { updates.push(`service_date = $${idx++}`); params.push(b.serviceDate); }
    if (b.mileageKm !== undefined) { updates.push(`mileage_km = $${idx++}`); params.push(b.mileageKm); }
    if (b.serviceType !== undefined) { updates.push(`service_type = $${idx++}`); params.push(b.serviceType); }
    if (b.partsReplaced !== undefined) { updates.push(`parts_replaced = $${idx++}`); params.push(b.partsReplaced); }
    if (b.workshop !== undefined) { updates.push(`workshop = $${idx++}`); params.push(b.workshop); }
    if (b.cost !== undefined) { updates.push(`cost = $${idx++}`); params.push(b.cost); }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    updates.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const updated = await executeReturning(
      `UPDATE service_logs SET ${updates.join(', ')} WHERE id = $${idx} RETURNING ${COLUMNS_SQL}`,
      params
    );
    if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(updated);
  })
);

// DELETE /api/services/:id
router.delete(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    await execute(`DELETE FROM service_logs WHERE id = $1`, [req.params.id]);
    res.status(204).send();
  })
);

export default router;
