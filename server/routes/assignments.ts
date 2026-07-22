import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const ASSIGNMENT_COLUMNS = [
  'id', 'vehicle_id', 'driver_id', 'start_date', 'end_date',
  'purpose', 'status', 'notes', 'created_at', 'updated_at',
];

const COLUMNS_SQL = ASSIGNMENT_COLUMNS.join(', ');

// GET /api/assignments — list all assignments
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(
      `SELECT a.id, a.vehicle_id, a.driver_id, a.start_date, a.end_date,
              a.purpose, a.status, a.notes, a.created_at, a.updated_at,
              v.plate_number, v.make, v.model,
              d.full_name AS driver_name
       FROM vehicle_assignments a
       LEFT JOIN vehicles v ON v.id = a.vehicle_id
       LEFT JOIN drivers d ON d.id = a.driver_id
       ORDER BY a.created_at DESC LIMIT $1`,
      [limit]
    );
    res.json(rows);
  })
);

// GET /api/assignments/active — list active assignments
router.get(
  '/active',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(
      `SELECT a.id, a.vehicle_id, a.driver_id, a.start_date, a.end_date,
              a.purpose, a.status, a.notes, a.created_at, a.updated_at,
              v.plate_number, v.make, v.model,
              d.full_name AS driver_name
       FROM vehicle_assignments a
       LEFT JOIN vehicles v ON v.id = a.vehicle_id
       LEFT JOIN drivers d ON d.id = a.driver_id
       WHERE a.status = 'active'
       ORDER BY a.created_at DESC LIMIT $1`,
      [limit]
    );
    res.json(rows);
  })
);

// GET /api/assignments/vehicle/:vehicleId
router.get(
  '/vehicle/:vehicleId',
  requireIdParam('vehicleId'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(
      `SELECT ${COLUMNS_SQL} FROM vehicle_assignments WHERE vehicle_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [req.params.vehicleId, limit]
    );
    res.json(rows);
  })
);

// GET /api/assignments/driver/:driverId
router.get(
  '/driver/:driverId',
  requireIdParam('driverId'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(
      `SELECT ${COLUMNS_SQL} FROM vehicle_assignments WHERE driver_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [req.params.driverId, limit]
    );
    res.json(rows);
  })
);

// POST /api/assignments — create assignment
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['vehicleId', 'driverId', 'startDate']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = randomUUID();
    const created = await executeReturning(
      `INSERT INTO vehicle_assignments (id, vehicle_id, driver_id, start_date, end_date, purpose, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COLUMNS_SQL}`,
      [id, b.vehicleId, b.driverId, b.startDate, b.endDate ?? null, b.purpose ?? '', b.status ?? 'active', b.notes ?? '']
    );
    res.status(201).json(created);
  })
);

// PUT /api/assignments/:id — update assignment
router.put(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const existing = await queryOne(`SELECT ${COLUMNS_SQL} FROM vehicle_assignments WHERE id = $1`, [req.params.id]);
    if (!existing) {
      res.status(404).json({ error: 'Assignment not found' });
      return;
    }

    const columnMap: Record<string, string> = {
      endDate: 'end_date',
      status: 'status',
      notes: 'notes',
    };

    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, column] of Object.entries(columnMap)) {
      if (req.body[key] !== undefined) {
        fields.push(`${column} = $${paramIndex}`);
        values.push(req.body[key]);
        paramIndex++;
      }
    }

    if (fields.length > 0) {
      fields.push(`updated_at = NOW()`);
      values.push(req.params.id);
      const updated = await executeReturning(
        `UPDATE vehicle_assignments SET ${fields.join(', ')} WHERE id = $${paramIndex}
         RETURNING ${COLUMNS_SQL}`,
        values
      );
      res.json(updated);
      return;
    }

    res.json(existing);
  })
);

// DELETE /api/assignments/:id — delete assignment (admin only)
router.delete(
  '/:id',
  requireRole('admin'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const result = await execute(`DELETE FROM vehicle_assignments WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Assignment not found' });
      return;
    }
    res.status(204).send();
  })
);

export default router;
