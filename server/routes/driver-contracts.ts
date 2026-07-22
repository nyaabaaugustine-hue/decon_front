import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const COLUMNS = [
  'id', 'driver_id', 'contract_type', 'start_date', 'end_date', 'education', 'qualifications',
  'experience_years', 'salary', 'status', 'notes', 'created_at', 'updated_at',
];

const COLUMNS_SQL = COLUMNS.join(', ');

// GET /api/driver-contracts — list all
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(
      `SELECT dc.*, d.full_name AS driver_name FROM driver_contracts dc JOIN drivers d ON d.id = dc.driver_id ORDER BY dc.start_date DESC LIMIT $1`,
      [limit]
    );
    res.json(rows);
  })
);

// GET /api/driver-contracts/driver/:driverId — list for one driver
router.get(
  '/driver/:driverId',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(
      `SELECT dc.*, d.full_name AS driver_name FROM driver_contracts dc JOIN drivers d ON d.id = dc.driver_id WHERE dc.driver_id = $1 ORDER BY dc.start_date DESC LIMIT $2`,
      [req.params.driverId, limit]
    );
    res.json(rows);
  })
);

// POST /api/driver-contracts — create
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['driverId', 'startDate']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = randomUUID();
    const created = await executeReturning(
      `INSERT INTO driver_contracts (id, driver_id, contract_type, start_date, end_date, education, qualifications, experience_years, salary, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${COLUMNS_SQL}`,
      [id, b.driverId, b.contractType ?? null, b.startDate, b.endDate ?? null, b.education ?? null, b.qualifications ?? null, parseInt(String(b.experienceYears || 0)), parseFloat(String(b.salary || 0)), b.status ?? null, b.notes ?? null]
    );
    res.status(201).json(created);
  })
);

// PUT /api/driver-contracts/:id — update
router.put(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const existing = await queryOne(`SELECT ${COLUMNS_SQL} FROM driver_contracts WHERE id = $1`, [req.params.id]);
    if (!existing) {
      res.status(404).json({ error: 'Driver contract not found' });
      return;
    }

    const columnMap: Record<string, string> = {
      contractType: 'contract_type',
      startDate: 'start_date',
      endDate: 'end_date',
      education: 'education',
      qualifications: 'qualifications',
      experienceYears: 'experience_years',
      salary: 'salary',
      status: 'status',
      notes: 'notes',
    };

    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, column] of Object.entries(columnMap)) {
      if (req.body[key] !== undefined) {
        fields.push(`${column} = $${paramIndex}`);
        let val = req.body[key];
        if (key === 'experienceYears') {
          val = parseInt(String(val || 0));
        } else if (key === 'salary') {
          val = parseFloat(String(val || 0));
        }
        values.push(val);
        paramIndex++;
      }
    }

    if (fields.length > 0) {
      fields.push(`updated_at = NOW()`);
      values.push(req.params.id);
      const updated = await executeReturning(
        `UPDATE driver_contracts SET ${fields.join(', ')} WHERE id = $${paramIndex}
         RETURNING ${COLUMNS_SQL}`,
        values
      );
      res.json(updated);
      return;
    }

    res.json(existing);
  })
);

// DELETE /api/driver-contracts/:id — delete (admin only)
router.delete(
  '/:id',
  requireRole('admin'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const result = await execute(`DELETE FROM driver_contracts WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Driver contract not found' });
      return;
    }
    res.status(204).send();
  })
);

export default router;
