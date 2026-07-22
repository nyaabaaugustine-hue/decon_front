import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const WORK_ORDER_COLUMNS = [
  'id', 'vehicle_id', 'title', 'description', 'priority', 'status',
  'assigned_to', 'estimated_cost', 'actual_cost', 'due_date',
  'completed_date', 'created_by', 'created_at', 'updated_at',
];

const COLUMNS_SQL = WORK_ORDER_COLUMNS.join(', ');

// GET /api/work-orders — list all work orders
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(`SELECT ${COLUMNS_SQL} FROM work_orders ORDER BY created_at DESC LIMIT $1`, [limit]);
    res.json(rows);
  })
);

// GET /api/work-orders/:id — single work order
router.get(
  '/:id',
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const row = await queryOne(`SELECT ${COLUMNS_SQL} FROM work_orders WHERE id = $1`, [req.params.id]);
    if (!row) {
      res.status(404).json({ error: 'Work order not found' });
      return;
    }
    res.json(row);
  })
);

// POST /api/work-orders — create work order
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['vehicleId', 'title']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = randomUUID();
    const createdBy = (req as any).user?.id ?? null;
    const created = await executeReturning(
      `INSERT INTO work_orders (id, vehicle_id, title, description, priority, status, assigned_to, estimated_cost, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${COLUMNS_SQL}`,
      [id, b.vehicleId, b.title, b.description ?? null, b.priority ?? 'medium', 'open', b.assignedTo ?? null, b.estimatedCost ?? null, b.dueDate ?? null, createdBy]
    );
    res.status(201).json(created);
  })
);

// PUT /api/work-orders/:id — update work order
router.put(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const existing = await queryOne(`SELECT ${COLUMNS_SQL} FROM work_orders WHERE id = $1`, [req.params.id]);
    if (!existing) {
      res.status(404).json({ error: 'Work order not found' });
      return;
    }

    const columnMap: Record<string, string> = {
      status: 'status',
      assignedTo: 'assigned_to',
      actualCost: 'actual_cost',
      completedDate: 'completed_date',
      description: 'description',
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
        `UPDATE work_orders SET ${fields.join(', ')} WHERE id = $${paramIndex}
         RETURNING ${COLUMNS_SQL}`,
        values
      );
      res.json(updated);
      return;
    }

    res.json(existing);
  })
);

// DELETE /api/work-orders/:id — delete (admin only)
router.delete(
  '/:id',
  requireRole('admin'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const result = await execute(`DELETE FROM work_orders WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Work order not found' });
      return;
    }
    res.status(204).send();
  })
);

export default router;
