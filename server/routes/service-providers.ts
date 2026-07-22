import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const PROVIDER_COLUMNS = [
  'id', 'name', 'type', 'phone', 'email', 'address',
  'specialties', 'rating', 'notes', 'created_at', 'updated_at',
];

const COLUMNS_SQL = PROVIDER_COLUMNS.join(', ');

// GET /api/service-providers — list all providers
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(`SELECT ${COLUMNS_SQL} FROM service_providers ORDER BY name LIMIT $1`, [limit]);
    res.json(rows);
  })
);

// POST /api/service-providers — create provider
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['name']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = randomUUID();
    const created = await executeReturning(
      `INSERT INTO service_providers (id, name, type, phone, email, address, specialties, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COLUMNS_SQL}`,
      [id, b.name, b.type ?? null, b.phone ?? null, b.email ?? null, b.address ?? null, b.specialties ?? null, b.notes ?? null]
    );
    res.status(201).json(created);
  })
);

// PUT /api/service-providers/:id — update provider
router.put(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const existing = await queryOne(`SELECT ${COLUMNS_SQL} FROM service_providers WHERE id = $1`, [req.params.id]);
    if (!existing) {
      res.status(404).json({ error: 'Service provider not found' });
      return;
    }

    const columnMap: Record<string, string> = {
      name: 'name',
      type: 'type',
      phone: 'phone',
      email: 'email',
      address: 'address',
      specialties: 'specialties',
      rating: 'rating',
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

    let updated: Record<string, any> = existing!;
    if (fields.length > 0) {
      const param = paramIndex;
      updated = (await executeReturning(
        `UPDATE service_providers SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${param}
         RETURNING ${COLUMNS_SQL}`,
        [...values, req.params.id]
      )) ?? existing;
    }

    res.json(updated);
  })
);

// DELETE /api/service-providers/:id — delete (admin only)
router.delete(
  '/:id',
  requireRole('admin'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const result = await execute(`DELETE FROM service_providers WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Service provider not found' });
      return;
    }
    res.status(204).send();
  })
);

export default router;
