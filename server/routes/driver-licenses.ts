import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const COLUMNS = [
  'id', 'driver_id', 'license_class', 'license_number', 'issue_date', 'expiry_date',
  'issuing_authority', 'status', 'notes', 'created_at', 'updated_at',
];

const COLUMNS_SQL = COLUMNS.join(', ');

// GET /api/driver-licenses — list all
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(
      `SELECT dl.*, d.full_name AS driver_name FROM driver_licenses dl JOIN drivers d ON d.id = dl.driver_id ORDER BY dl.expiry_date DESC LIMIT $1`,
      [limit]
    );
    res.json(rows);
  })
);

// GET /api/driver-licenses/driver/:driverId — list for one driver
router.get(
  '/driver/:driverId',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(
      `SELECT dl.*, d.full_name AS driver_name FROM driver_licenses dl JOIN drivers d ON d.id = dl.driver_id WHERE dl.driver_id = $1 ORDER BY dl.expiry_date DESC LIMIT $2`,
      [req.params.driverId, limit]
    );
    res.json(rows);
  })
);

// POST /api/driver-licenses — create
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['driverId', 'licenseNumber', 'issueDate', 'expiryDate']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = randomUUID();
    const created = await executeReturning(
      `INSERT INTO driver_licenses (id, driver_id, license_class, license_number, issue_date, expiry_date, issuing_authority, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${COLUMNS_SQL}`,
      [id, b.driverId, b.licenseClass ?? null, b.licenseNumber, b.issueDate, b.expiryDate, b.issuingAuthority ?? null, b.status ?? null, b.notes ?? null]
    );
    res.status(201).json(created);
  })
);

// PUT /api/driver-licenses/:id — update
router.put(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const existing = await queryOne(`SELECT ${COLUMNS_SQL} FROM driver_licenses WHERE id = $1`, [req.params.id]);
    if (!existing) {
      res.status(404).json({ error: 'Driver license not found' });
      return;
    }

    const columnMap: Record<string, string> = {
      licenseClass: 'license_class',
      licenseNumber: 'license_number',
      issueDate: 'issue_date',
      expiryDate: 'expiry_date',
      issuingAuthority: 'issuing_authority',
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
        `UPDATE driver_licenses SET ${fields.join(', ')} WHERE id = $${paramIndex}
         RETURNING ${COLUMNS_SQL}`,
        values
      );
      res.json(updated);
      return;
    }

    res.json(existing);
  })
);

// DELETE /api/driver-licenses/:id — delete (admin only)
router.delete(
  '/:id',
  requireRole('admin'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const result = await execute(`DELETE FROM driver_licenses WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Driver license not found' });
      return;
    }
    res.status(204).send();
  })
);

export default router;
