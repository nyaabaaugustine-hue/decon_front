import { Router } from 'express';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import type { Supervisor } from '../types.js';
import { randomUUID } from 'crypto';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const SUPERVISOR_COLUMNS = [
  'id', 'full_name', 'phone', 'region', 'created_at', 'updated_at',
];

const COLUMNS_SQL = SUPERVISOR_COLUMNS.join(', ');

// GET /api/supervisors — list all (with optional pagination)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const cursor = req.query.cursor as string | undefined;

    let sql: string;
    let params: any[];

    if (cursor) {
      sql = `SELECT ${COLUMNS_SQL} FROM supervisors WHERE deleted_at IS NULL AND (full_name > (SELECT full_name FROM supervisors WHERE id = $1) OR (full_name = (SELECT full_name FROM supervisors WHERE id = $1) AND id > $1)) ORDER BY full_name, id LIMIT $2`;
      params = [cursor, limit + 1];
    } else {
      sql = `SELECT ${COLUMNS_SQL} FROM supervisors WHERE deleted_at IS NULL ORDER BY full_name, id LIMIT $1`;
      params = [limit + 1];
    }

    const rows = await query<Supervisor>(sql, params);
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();

    res.set({
      'X-Has-More': String(hasMore),
      ...(hasMore && rows.length > 0 ? { 'X-Next-Cursor': rows[rows.length - 1].id } : {}),
    });
    res.json(rows);
  })
);

// GET /api/supervisors/:id
router.get(
  '/:id',
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const row = await queryOne<Supervisor>(
      `SELECT ${COLUMNS_SQL} FROM supervisors WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!row) {
      res.status(404).json({ error: 'Supervisor not found' });
      return;
    }
    res.json(row);
  })
);

// POST /api/supervisors
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['fullName', 'phone', 'region']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = randomUUID();
    const created = await executeReturning<Supervisor>(
      `INSERT INTO supervisors (id, full_name, phone, region) VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNS_SQL}`,
      [id, b.fullName, b.phone, b.region]
    );
    res.status(201).json(created);
  })
);

// PATCH /api/supervisors/:id
router.patch(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const existing = await queryOne<Supervisor>(
      `SELECT ${COLUMNS_SQL} FROM supervisors WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!existing) {
      res.status(404).json({ error: 'Supervisor not found' });
      return;
    }

    const columnMap: Record<string, string> = {
      fullName: 'full_name',
      phone: 'phone',
      region: 'region',
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

    let updated: Supervisor | null = null;
    if (fields.length > 0) {
      values.push(req.params.id);
      updated = await executeReturning<Supervisor>(
        `UPDATE supervisors SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING ${COLUMNS_SQL}`,
        values
      );
    } else {
      updated = existing;
    }
    res.json(updated);
  })
);

// DELETE /api/supervisors/:id — soft delete
router.delete(
  '/:id',
  requireRole('admin'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const result = await execute(
      `UPDATE supervisors SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Supervisor not found' });
      return;
    }
    res.status(204).send();
  })
);

export default router;
