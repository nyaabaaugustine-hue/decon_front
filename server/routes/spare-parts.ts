import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const SPARE_PART_COLUMNS = [
  'id', 'name', 'part_number', 'category', 'quantity', 'min_quantity',
  'unit_cost', 'supplier', 'location', 'created_at', 'updated_at',
];

const COLUMNS_SQL = SPARE_PART_COLUMNS.join(', ');

// GET /api/spare-parts — list all parts
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(`SELECT ${COLUMNS_SQL} FROM spare_parts ORDER BY name LIMIT $1`, [limit]);
    res.json(rows);
  })
);

// GET /api/spare-parts/low-stock — parts where quantity <= min_quantity
router.get(
  '/low-stock',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(
      `SELECT ${COLUMNS_SQL} FROM spare_parts WHERE quantity <= min_quantity ORDER BY name LIMIT $1`,
      [limit]
    );
    res.json(rows);
  })
);

// POST /api/spare-parts — create part
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['name']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = randomUUID();
    const created = await executeReturning(
      `INSERT INTO spare_parts (id, name, part_number, category, quantity, min_quantity, unit_cost, supplier, location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${COLUMNS_SQL}`,
      [id, b.name, b.partNumber ?? null, b.category ?? null, b.quantity ?? 0, b.minQuantity ?? 0, b.unitCost ?? null, b.supplier ?? null, b.location ?? null]
    );
    res.status(201).json(created);
  })
);

// PUT /api/spare-parts/:id — update part
router.put(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const existing = await queryOne(`SELECT ${COLUMNS_SQL} FROM spare_parts WHERE id = $1`, [req.params.id]);
    if (!existing) {
      res.status(404).json({ error: 'Spare part not found' });
      return;
    }

    const columnMap: Record<string, string> = {
      quantity: 'quantity',
      minQuantity: 'min_quantity',
      unitCost: 'unit_cost',
      supplier: 'supplier',
      location: 'location',
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
        `UPDATE spare_parts SET ${fields.join(', ')} WHERE id = $${paramIndex}
         RETURNING ${COLUMNS_SQL}`,
        values
      );
      res.json(updated);
      return;
    }

    res.json(existing);
  })
);

// DELETE /api/spare-parts/:id — delete (admin only)
router.delete(
  '/:id',
  requireRole('admin'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const result = await execute(`DELETE FROM spare_parts WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Spare part not found' });
      return;
    }
    res.status(204).send();
  })
);

export default router;
