import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const FUEL_COLUMNS = [
  'id', 'vehicle_id', 'driver_id', 'fuel_date', 'station',
  'fuel_type', 'liters', 'cost_per_liter', 'total_cost',
  'mileage_km', 'fuel_card', 'receipt_number', 'created_at', 'updated_at',
];

const COLUMNS_SQL = FUEL_COLUMNS.join(', ');

// GET /api/fuel — list all fuel entries
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(`SELECT ${COLUMNS_SQL} FROM fuel_entries ORDER BY fuel_date DESC LIMIT $1`, [limit]);
    res.json(rows);
  })
);

// GET /api/fuel/vehicle/:vehicleId
router.get(
  '/vehicle/:vehicleId',
  requireIdParam('vehicleId'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(
      `SELECT ${COLUMNS_SQL} FROM fuel_entries WHERE vehicle_id = $1 ORDER BY fuel_date DESC LIMIT $2`,
      [req.params.vehicleId, limit]
    );
    res.json(rows);
  })
);

// POST /api/fuel — create fuel entry
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['vehicleId', 'fuelDate', 'station', 'fuelType', 'liters', 'costPerLiter', 'totalCost']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = randomUUID();
    const created = await executeReturning(
      `INSERT INTO fuel_entries (id, vehicle_id, driver_id, fuel_date, station, fuel_type, liters, cost_per_liter, total_cost, mileage_km, fuel_card, receipt_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING ${COLUMNS_SQL}`,
      [id, b.vehicleId, b.driverId ?? null, b.fuelDate, b.station, b.fuelType, b.liters, b.costPerLiter, b.totalCost, b.mileageKm ?? null, b.fuelCard ?? null, b.receiptNumber ?? null]
    );
    res.status(201).json(created);
  })
);

// DELETE /api/fuel/:id — delete (admin only)
router.delete(
  '/:id',
  requireRole('admin'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const result = await execute(`DELETE FROM fuel_entries WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Fuel entry not found' });
      return;
    }
    res.status(204).send();
  })
);

export default router;
