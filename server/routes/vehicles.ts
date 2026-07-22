import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import type { Vehicle } from '../types.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const ALLOWED_STATUSES = ['active', 'in_repair', 'decommissioned', 'sold'];

const VEHICLE_COLUMNS = [
  'id', 'plate_number', 'make', 'model', 'year', 'vin',
  'purchase_date', 'purchase_price', 'status', 'current_driver_id',
  'created_at', 'updated_at',
];

const COLUMNS_SQL = VEHICLE_COLUMNS.join(', ');

// GET /api/vehicles — list all vehicles (with optional pagination)
// Query params: ?limit=N&cursor=lastId
// Returns: Vehicle[] array
// Headers: X-Has-More, X-Next-Cursor
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const cursor = req.query.cursor as string | undefined;

    let sql: string;
    let params: any[];

    if (cursor) {
      sql = `SELECT ${COLUMNS_SQL} FROM vehicles WHERE deleted_at IS NULL AND (created_at < (SELECT created_at FROM vehicles WHERE id = $1) OR (created_at = (SELECT created_at FROM vehicles WHERE id = $1) AND id < $1)) ORDER BY created_at DESC, id DESC LIMIT $2`;
      params = [cursor, limit + 1];
    } else {
      sql = `SELECT ${COLUMNS_SQL} FROM vehicles WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT $1`;
      params = [limit + 1];
    }

    const vehicles = await query<Vehicle>(sql, params);
    const hasMore = vehicles.length > limit;
    if (hasMore) vehicles.pop();

    res.set({
      'X-Has-More': String(hasMore),
      ...(hasMore && vehicles.length > 0 ? { 'X-Next-Cursor': vehicles[vehicles.length - 1].id } : {}),
    });
    res.json(vehicles);
  })
);

// GET /api/vehicles/:id — single vehicle
router.get(
  '/:id',
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const vehicle = await queryOne<Vehicle>(
      `SELECT ${COLUMNS_SQL} FROM vehicles WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!vehicle) {
      res.status(404).json({ error: 'Vehicle not found' });
      return;
    }
    res.json(vehicle);
  })
);

// POST /api/vehicles — create vehicle
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['plateNumber', 'make', 'model', 'year', 'vin', 'purchaseDate', 'purchasePrice']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    if (b.status && !ALLOWED_STATUSES.includes(b.status)) {
      res.status(400).json({ error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` });
      return;
    }

    const id = randomUUID();
    const created = await executeReturning<Vehicle>(
      `INSERT INTO vehicles (id, plate_number, make, model, year, vin, purchase_date, purchase_price, status, current_driver_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${COLUMNS_SQL}`,
      [
        id,
        b.plateNumber,
        b.make,
        b.model,
        b.year,
        b.vin,
        b.purchaseDate,
        b.purchasePrice,
        b.status ?? 'active',
        b.currentDriverId ?? null,
      ]
    );
    res.status(201).json(created);
  })
);

// PATCH /api/vehicles/:id — partial update
router.patch(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const existing = await queryOne<Vehicle>(
      `SELECT ${COLUMNS_SQL} FROM vehicles WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!existing) {
      res.status(404).json({ error: 'Vehicle not found' });
      return;
    }

    if (req.body.status && !ALLOWED_STATUSES.includes(req.body.status)) {
      res.status(400).json({ error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` });
      return;
    }

    const columnMap: Record<string, string> = {
      plateNumber: 'plate_number',
      make: 'make',
      model: 'model',
      year: 'year',
      vin: 'vin',
      purchaseDate: 'purchase_date',
      purchasePrice: 'purchase_price',
      status: 'status',
      currentDriverId: 'current_driver_id',
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

    let updated: Vehicle | null = null;
    if (fields.length > 0) {
      values.push(req.params.id);
      updated = await executeReturning<Vehicle>(
        `UPDATE vehicles SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING ${COLUMNS_SQL}`,
        values
      );
    } else {
      updated = existing;
    }
    res.json(updated);
  })
);

// DELETE /api/vehicles/:id — soft delete
router.delete(
  '/:id',
  requireRole('admin'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const result = await execute(
      `UPDATE vehicles SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Vehicle not found' });
      return;
    }
    res.status(204).send();
  })
);

export default router;
