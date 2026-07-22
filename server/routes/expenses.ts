import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const EXPENSE_COLUMNS = [
  'id', 'vehicle_id', 'driver_id', 'category', 'description', 'amount',
  'expense_date', 'receipt_url', 'status', 'approved_by', 'notes',
  'created_at', 'updated_at',
];

const COLUMNS_SQL = EXPENSE_COLUMNS.join(', ');

// GET /api/expenses — list all expenses
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(`SELECT ${COLUMNS_SQL} FROM expenses ORDER BY expense_date DESC LIMIT $1`, [limit]);
    res.json(rows);
  })
);

// GET /api/expenses/vehicle/:vehicleId
router.get(
  '/vehicle/:vehicleId',
  requireIdParam('vehicleId'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(
      `SELECT ${COLUMNS_SQL} FROM expenses WHERE vehicle_id = $1 ORDER BY expense_date DESC LIMIT $2`,
      [req.params.vehicleId, limit]
    );
    res.json(rows);
  })
);

// GET /api/expenses/category/:category
router.get(
  '/category/:category',
  requireIdParam('category'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(
      `SELECT ${COLUMNS_SQL} FROM expenses WHERE category = $1 ORDER BY expense_date DESC LIMIT $2`,
      [req.params.category, limit]
    );
    res.json(rows);
  })
);

// POST /api/expenses — create expense
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['category', 'description', 'amount', 'expenseDate']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = randomUUID();
    const created = await executeReturning(
      `INSERT INTO expenses (id, vehicle_id, driver_id, category, description, amount, expense_date, receipt_url, status, approved_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${COLUMNS_SQL}`,
      [id, b.vehicleId ?? null, b.driverId ?? null, b.category, b.description, b.amount, b.expenseDate, b.receiptUrl ?? null, 'pending', null, b.notes ?? null]
    );
    res.status(201).json(created);
  })
);

// PUT /api/expenses/:id — update expense
router.put(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const existing = await queryOne(`SELECT ${COLUMNS_SQL} FROM expenses WHERE id = $1`, [req.params.id]);
    if (!existing) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }

    const columnMap: Record<string, string> = {
      status: 'status',
      approvedBy: 'approved_by',
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
        `UPDATE expenses SET ${fields.join(', ')} WHERE id = $${paramIndex}
         RETURNING ${COLUMNS_SQL}`,
        values
      );
      res.json(updated);
      return;
    }

    res.json(existing);
  })
);

// DELETE /api/expenses/:id — delete (admin only)
router.delete(
  '/:id',
  requireRole('admin'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const result = await execute(`DELETE FROM expenses WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }
    res.status(204).send();
  })
);

export default router;
