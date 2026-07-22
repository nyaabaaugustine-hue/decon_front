import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const ALLOWED_STATUSES = ['pass', 'fail', 'flagged'];

const INSPECTION_COLUMNS = [
  'id', 'vehicle_id', 'driver_name', 'inspection_date', 'overall_status',
  'checklist', 'notes', 'photo_count', 'created_at', 'updated_at',
];

const COLUMNS_SQL = INSPECTION_COLUMNS.join(', ');

// GET /api/inspections — list all (with optional pagination)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const cursor = req.query.cursor as string | undefined;

    let sql: string;
    let params: any[];

    if (cursor) {
      sql = `SELECT ${COLUMNS_SQL} FROM inspections WHERE (inspection_date < (SELECT inspection_date FROM inspections WHERE id = $1) OR (inspection_date = (SELECT inspection_date FROM inspections WHERE id = $1) AND id < $1)) ORDER BY inspection_date DESC, id DESC LIMIT $2`;
      params = [cursor, limit + 1];
    } else {
      sql = `SELECT ${COLUMNS_SQL} FROM inspections ORDER BY inspection_date DESC, id DESC LIMIT $1`;
      params = [limit + 1];
    }

    const rows = await query(sql, params);
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();

    res.set({
      'X-Has-More': String(hasMore),
      ...(hasMore && rows.length > 0 ? { 'X-Next-Cursor': rows[rows.length - 1].id } : {}),
    });
    res.json(rows);
  })
);

// GET /api/inspections/vehicle/:vehicleId
router.get(
  '/vehicle/:vehicleId',
  requireIdParam('vehicleId'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(
      `SELECT ${COLUMNS_SQL} FROM inspections WHERE vehicle_id = $1 ORDER BY inspection_date DESC LIMIT $2`,
      [req.params.vehicleId, limit]
    );
    res.json(rows);
  })
);

// GET /api/inspections/:id
router.get(
  '/:id',
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const row = await queryOne(
      `SELECT ${COLUMNS_SQL} FROM inspections WHERE id = $1`,
      [req.params.id]
    );
    if (!row) {
      res.status(404).json({ error: 'Inspection not found' });
      return;
    }
    res.json(row);
  })
);

// POST /api/inspections
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['vehicleId', 'driverName', 'inspectionDate', 'overallStatus', 'checklist']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    if (!ALLOWED_STATUSES.includes(b.overallStatus)) {
      res.status(400).json({ error: `overallStatus must be one of: ${ALLOWED_STATUSES.join(', ')}` });
      return;
    }
    const id = randomUUID();
    const created = await executeReturning(
      `INSERT INTO inspections (id, vehicle_id, driver_name, inspection_date, overall_status, checklist, notes, photo_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COLUMNS_SQL}`,
      [
        id,
        b.vehicleId,
        b.driverName,
        b.inspectionDate,
        b.overallStatus,
        JSON.stringify(b.checklist),
        b.notes ?? '',
        b.photoCount ?? 0,
      ]
    );
    res.status(201).json(created);
  })
);

// PATCH /api/inspections/:id
router.patch(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (b.driverName !== undefined) { updates.push(`driver_name = $${idx++}`); params.push(b.driverName); }
    if (b.inspectionDate !== undefined) { updates.push(`inspection_date = $${idx++}`); params.push(b.inspectionDate); }
    if (b.overallStatus !== undefined) {
      if (!ALLOWED_STATUSES.includes(b.overallStatus)) {
        res.status(400).json({ error: `overallStatus must be one of: ${ALLOWED_STATUSES.join(', ')}` });
        return;
      }
      updates.push(`overall_status = $${idx++}`); params.push(b.overallStatus);
    }
    if (b.checklist !== undefined) { updates.push(`checklist = $${idx++}`); params.push(JSON.stringify(b.checklist)); }
    if (b.notes !== undefined) { updates.push(`notes = $${idx++}`); params.push(b.notes); }
    if (b.photoCount !== undefined) { updates.push(`photo_count = $${idx++}`); params.push(b.photoCount); }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    updates.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const updated = await executeReturning(
      `UPDATE inspections SET ${updates.join(', ')} WHERE id = $${idx} RETURNING ${COLUMNS_SQL}`,
      params
    );
    if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(updated);
  })
);

// DELETE /api/inspections/:id
router.delete(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    await execute(`DELETE FROM inspections WHERE id = $1`, [req.params.id]);
    res.status(204).send();
  })
);

export default router;
