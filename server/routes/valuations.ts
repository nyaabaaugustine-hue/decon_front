import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import type { Valuation } from '../types.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const VALUATION_COLUMNS = [
  'id', 'vehicle_id', 'valuation_date', 'source', 'amount',
  'condition_notes', 'created_at', 'updated_at',
];

const COLUMNS_SQL = VALUATION_COLUMNS.join(', ');

// GET /api/valuations/vehicle/:vehicleId
router.get(
  '/vehicle/:vehicleId',
  requireIdParam('vehicleId'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const valuations = await query<Valuation>(
      `SELECT ${COLUMNS_SQL} FROM valuations WHERE vehicle_id = $1 ORDER BY valuation_date DESC LIMIT $2`,
      [req.params.vehicleId, limit]
    );
    res.json(valuations);
  })
);

// POST /api/valuations
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['vehicleId', 'valuationDate', 'source', 'amount', 'conditionNotes']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = randomUUID();
    const created = await executeReturning<Valuation>(
      `INSERT INTO valuations (id, vehicle_id, valuation_date, source, amount, condition_notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNS_SQL}`,
      [id, b.vehicleId, b.valuationDate, b.source, b.amount, b.conditionNotes]
    );
    res.status(201).json(created);
  })
);

// PATCH /api/valuations/:id
router.patch(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (b.valuationDate !== undefined) { updates.push(`valuation_date = $${idx++}`); params.push(b.valuationDate); }
    if (b.source !== undefined) { updates.push(`source = $${idx++}`); params.push(b.source); }
    if (b.amount !== undefined) { updates.push(`amount = $${idx++}`); params.push(b.amount); }
    if (b.conditionNotes !== undefined) { updates.push(`condition_notes = $${idx++}`); params.push(b.conditionNotes); }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    updates.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const updated = await executeReturning(
      `UPDATE valuations SET ${updates.join(', ')} WHERE id = $${idx} RETURNING ${COLUMNS_SQL}`,
      params
    );
    if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(updated);
  })
);

// DELETE /api/valuations/:id
router.delete(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    await execute(`DELETE FROM valuations WHERE id = $1`, [req.params.id]);
    res.status(204).send();
  })
);

export default router;
