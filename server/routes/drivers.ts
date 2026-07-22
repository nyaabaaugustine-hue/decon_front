import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import type { Driver } from '../types.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const DRIVER_COLUMNS = [
  'id', 'full_name', 'phone', 'license_number', 'supervisor_id',
  'hire_date', 'status', 'photo_url', 'created_at', 'updated_at',
];

const COLUMNS_SQL = DRIVER_COLUMNS.join(', ');

// GET /api/drivers — list all drivers (with optional pagination)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const cursor = req.query.cursor as string | undefined;

    let sql: string;
    let params: any[];

    if (cursor) {
      sql = `SELECT ${COLUMNS_SQL} FROM drivers WHERE deleted_at IS NULL AND (full_name > (SELECT full_name FROM drivers WHERE id = $1) OR (full_name = (SELECT full_name FROM drivers WHERE id = $1) AND id > $1)) ORDER BY full_name, id LIMIT $2`;
      params = [cursor, limit + 1];
    } else {
      sql = `SELECT ${COLUMNS_SQL} FROM drivers WHERE deleted_at IS NULL ORDER BY full_name, id LIMIT $1`;
      params = [limit + 1];
    }

    const drivers = await query<Driver>(sql, params);
    const hasMore = drivers.length > limit;
    if (hasMore) drivers.pop();

    res.set({
      'X-Has-More': String(hasMore),
      ...(hasMore && drivers.length > 0 ? { 'X-Next-Cursor': drivers[drivers.length - 1].id } : {}),
    });
    res.json(drivers);
  })
);

// GET /api/drivers/:id
router.get(
  '/:id',
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const driver = await queryOne<Driver>(
      `SELECT ${COLUMNS_SQL} FROM drivers WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!driver) {
      res.status(404).json({ error: 'Driver not found' });
      return;
    }
    res.json(driver);
  })
);

// GET /api/drivers/:id/profile — full driver profile with all related data
router.get(
  '/:id/profile',
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const driverId = req.params.id;

    const driver = await queryOne(
      `SELECT ${COLUMNS_SQL} FROM drivers WHERE id = $1 AND deleted_at IS NULL`,
      [driverId]
    );
    if (!driver) {
      res.status(404).json({ error: 'Driver not found' });
      return;
    }

    const [supervisor, assignedVehicle, inspections, revenueList, accidentReports, revenueAgg] = await Promise.all([
      // Supervisor info
      queryOne<{ id: string; full_name: string; phone: string; region: string }>(
        `SELECT id, full_name, phone, region FROM supervisors WHERE id = $1 AND deleted_at IS NULL`,
        [driver.supervisor_id]
      ),
      // Assigned vehicle
      queryOne<{ id: string; plate_number: string; make: string; model: string; year: number; status: string }>(
        `SELECT id, plate_number, make, model, year, status FROM vehicles WHERE current_driver_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
        [driverId]
      ),
      // Inspections where this driver participated
      query<{ id: string; vehicle_id: string; inspection_date: string; overall_status: string; notes: string; photo_count: number }>(
        `SELECT id, vehicle_id, inspection_date, overall_status, notes, photo_count FROM inspections WHERE driver_name = $1 ORDER BY inspection_date DESC LIMIT 20`,
        [driver.full_name]
      ),
      // Revenue entries
      query<{ id: string; vehicle_id: string; trip_date: string; trip_reference: string; route: string; client: string; amount: string }>(
        `SELECT id, vehicle_id, trip_date, trip_reference, route, client, amount FROM revenue_entries WHERE driver_id = $1 ORDER BY trip_date DESC LIMIT 20`,
        [driverId]
      ),
      // Accident reports
      query<{ id: string; vehicle_id: string; accident_date: string; description: string; cost: string; driver_at_fault: boolean }>(
        `SELECT id, vehicle_id, accident_date, description, cost, driver_at_fault FROM accident_reports WHERE driver_id = $1 ORDER BY accident_date DESC LIMIT 20`,
        [driverId]
      ),
      // Total revenue and trip count
      queryOne<{ total: string; count: string }>(
        `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM revenue_entries WHERE driver_id = $1`,
        [driverId]
      ),
    ]);

    res.json({
      driver,
      supervisor: supervisor ? { id: supervisor.id, fullName: supervisor.full_name, phone: supervisor.phone, region: supervisor.region } : null,
      assignedVehicle: assignedVehicle ? { id: assignedVehicle.id, plateNumber: assignedVehicle.plate_number, make: assignedVehicle.make, model: assignedVehicle.model, year: assignedVehicle.year, status: assignedVehicle.status } : null,
      inspections: inspections.map(i => ({ id: i.id, vehicleId: i.vehicle_id, inspectionDate: i.inspection_date, overallStatus: i.overall_status, notes: i.notes, photoCount: i.photo_count })),
      revenue: {
        total: parseFloat(revenueAgg?.total || '0'),
        trips: parseInt(revenueAgg?.count || '0', 10),
        entries: revenueList.map(r => ({ id: r.id, vehicleId: r.vehicle_id, tripDate: r.trip_date, tripReference: r.trip_reference, route: r.route, client: r.client, amount: parseFloat(r.amount) })),
      },
      accidents: accidentReports.map(a => ({ id: a.id, vehicleId: a.vehicle_id, accidentDate: a.accident_date, description: a.description, cost: parseFloat(a.cost), driverAtFault: a.driver_at_fault })),
    });
  })
);

// POST /api/drivers — create driver
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['fullName', 'phone', 'licenseNumber', 'hireDate']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = randomUUID();
    const created = await executeReturning<Driver>(
      `INSERT INTO drivers (id, full_name, phone, license_number, supervisor_id, hire_date, status, photo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COLUMNS_SQL}`,
      [id, b.fullName, b.phone, b.licenseNumber, b.supervisorId ?? null, b.hireDate, b.status ?? 'active', b.photoUrl ?? null]
    );
    res.status(201).json(created);
  })
);

// PATCH /api/drivers/:id
router.patch(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const existing = await queryOne<Driver>(
      `SELECT ${COLUMNS_SQL} FROM drivers WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!existing) {
      res.status(404).json({ error: 'Driver not found' });
      return;
    }

    const columnMap: Record<string, string> = {
      fullName: 'full_name',
      phone: 'phone',
      licenseNumber: 'license_number',
      supervisorId: 'supervisor_id',
      hireDate: 'hire_date',
      status: 'status',
      photoUrl: 'photo_url',
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

    let updated: Driver | null = null;
    if (fields.length > 0) {
      values.push(req.params.id);
      updated = await executeReturning<Driver>(
        `UPDATE drivers SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING ${COLUMNS_SQL}`,
        values
      );
    } else {
      updated = existing;
    }
    res.json(updated);
  })
);

// DELETE /api/drivers/:id — soft delete
router.delete(
  '/:id',
  requireRole('admin'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const result = await execute(
      `UPDATE drivers SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Driver not found' });
      return;
    }
    res.status(204).send();
  })
);

export default router;
