import { Router } from 'express';
import { query, queryOne } from '../db.js';
import { requireIdParam, asyncHandler } from '../validate.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

// ── Vehicle Stats ──────────────────────────────────────────────────────────────

/**
 * GET /api/stats/vehicles/:id
 *
 * Aggregated financial and operational stats for a single vehicle.
 * Returns: revenue totals, cost totals, net margin, service/battery/tyre counts,
 *          accident count, inspection pass/fail counts, current valuation.
 */
router.get(
  '/vehicles/:id',
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const vehicleId = req.params.id;

    // Verify vehicle exists
    const vehicle = await queryOne<{ id: string; plate_number: string; status: string }>(
      `SELECT id, plate_number, status FROM vehicles WHERE id = $1 AND deleted_at IS NULL`,
      [vehicleId]
    );
    if (!vehicle) {
      res.status(404).json({ error: 'Vehicle not found' });
      return;
    }

    // Run all aggregation queries in parallel
    const [
      revenueAgg,
      serviceAgg,
      batteryAgg,
      tyreAgg,
      accidentAgg,
      inspectionAgg,
      latestValuation,
      totalTrips,
    ] = await Promise.all([
      // Total revenue
      queryOne<{ total: string; count: number }>(
        `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM revenue_entries WHERE vehicle_id = $1`,
        [vehicleId]
      ),
      // Service costs + count
      queryOne<{ total: string; count: number }>(
        `SELECT COALESCE(SUM(cost), 0) AS total, COUNT(*) AS count FROM service_logs WHERE vehicle_id = $1`,
        [vehicleId]
      ),
      // Battery costs
      queryOne<{ total: string; count: number }>(
        `SELECT COALESCE(SUM(cost), 0) AS total, COUNT(*) AS count FROM battery_logs WHERE vehicle_id = $1`,
        [vehicleId]
      ),
      // Tyre costs
      queryOne<{ total: string; count: number }>(
        `SELECT COALESCE(SUM(cost), 0) AS total, COUNT(*) AS count FROM tyre_logs WHERE vehicle_id = $1`,
        [vehicleId]
      ),
      // Accident costs + count
      queryOne<{ total: string; count: number }>(
        `SELECT COALESCE(SUM(cost), 0) AS total, COUNT(*) AS count FROM accident_reports WHERE vehicle_id = $1`,
        [vehicleId]
      ),
      // Inspection pass/fail counts
      query<{ overall_status: string; count: number }>(
        `SELECT overall_status, COUNT(*) AS count FROM inspections WHERE vehicle_id = $1 GROUP BY overall_status`,
        [vehicleId]
      ),
      // Latest valuation
      queryOne<{ amount: string; source: string; valuation_date: string }>(
        `SELECT amount, source, valuation_date FROM valuations WHERE vehicle_id = $1 ORDER BY valuation_date DESC LIMIT 1`,
        [vehicleId]
      ),
      // Trip count
      queryOne<{ count: number }>(
        `SELECT COUNT(*) AS count FROM revenue_entries WHERE vehicle_id = $1`,
        [vehicleId]
      ),
    ]);

    const revenueTotal = parseFloat(revenueAgg?.total || '0');
    const serviceTotal = parseFloat(serviceAgg?.total || '0');
    const batteryTotal = parseFloat(batteryAgg?.total || '0');
    const tyreTotal = parseFloat(tyreAgg?.total || '0');
    const accidentTotal = parseFloat(accidentAgg?.total || '0');
    const totalCosts = serviceTotal + batteryTotal + tyreTotal + accidentTotal;

    const inspectionCounts: Record<string, number> = {};
    for (const row of inspectionAgg || []) {
      inspectionCounts[row.overall_status] = row.count;
    }

    res.json({
      vehicleId: vehicle.id,
      plateNumber: vehicle.plate_number,
      status: vehicle.status,
      revenue: {
        total: revenueTotal,
        count: revenueAgg?.count || 0,
      },
      costs: {
        total: totalCosts,
        service: serviceTotal,
        serviceCount: serviceAgg?.count || 0,
        battery: batteryTotal,
        batteryCount: batteryAgg?.count || 0,
        tyre: tyreTotal,
        tyreCount: tyreAgg?.count || 0,
        accident: accidentTotal,
        accidentCount: accidentAgg?.count || 0,
      },
      netMargin: revenueTotal - totalCosts,
      inspections: {
        pass: inspectionCounts['pass'] || 0,
        fail: inspectionCounts['fail'] || 0,
        flagged: inspectionCounts['flagged'] || 0,
        total: (inspectionCounts['pass'] || 0) + (inspectionCounts['fail'] || 0) + (inspectionCounts['flagged'] || 0),
      },
      trips: totalTrips?.count || 0,
      latestValuation: latestValuation
        ? { amount: parseFloat(latestValuation.amount), source: latestValuation.source, date: latestValuation.valuation_date }
        : null,
    });
  })
);

// ── Driver Stats ───────────────────────────────────────────────────────────────

/**
 * GET /api/stats/drivers/:id
 *
 * Aggregated stats for a single driver: revenue generated, assigned vehicle,
 * active trips, accidents at fault.
 */
router.get(
  '/drivers/:id',
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const driverId = req.params.id;

    const driver = await queryOne<{ id: string; full_name: string; status: string }>(
      `SELECT id, full_name, status FROM drivers WHERE id = $1 AND deleted_at IS NULL`,
      [driverId]
    );
    if (!driver) {
      res.status(404).json({ error: 'Driver not found' });
      return;
    }

    const [revenueAgg, assignedVehicle, accidentAgg, tripCount, recentTrips] = await Promise.all([
      // Total revenue generated
      queryOne<{ total: string; count: number }>(
        `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM revenue_entries WHERE driver_id = $1`,
        [driverId]
      ),
      // Currently assigned vehicle
      queryOne<{ id: string; plate_number: string; make: string; model: string }>(
        `SELECT id, plate_number, make, model FROM vehicles WHERE current_driver_id = $1 AND deleted_at IS NULL AND status = 'active' LIMIT 1`,
        [driverId]
      ),
      // Accidents at fault
      queryOne<{ total: number; atFault: number }>(
        `SELECT COUNT(*)::int AS total, COALESCE(SUM(CASE WHEN driver_at_fault THEN 1 ELSE 0 END), 0)::int AS "atFault" FROM accident_reports WHERE driver_id = $1`,
        [driverId]
      ),
      // Total trips
      queryOne<{ count: number }>(
        `SELECT COUNT(*) AS count FROM revenue_entries WHERE driver_id = $1`,
        [driverId]
      ),
      // Recent 5 trips
      query<{ trip_date: string; route: string; client: string; amount: string }>(
        `SELECT trip_date, route, client, amount FROM revenue_entries WHERE driver_id = $1 ORDER BY trip_date DESC LIMIT 5`,
        [driverId]
      ),
    ]);

    res.json({
      driverId: driver.id,
      fullName: driver.full_name,
      status: driver.status,
      revenue: {
        total: parseFloat(revenueAgg?.total || '0'),
        trips: revenueAgg?.count || 0,
      },
      assignedVehicle: assignedVehicle
        ? { id: assignedVehicle.id, plateNumber: assignedVehicle.plate_number, make: assignedVehicle.make, model: assignedVehicle.model }
        : null,
      accidents: {
        total: accidentAgg?.total || 0,
        atFault: accidentAgg?.atFault || 0,
      },
      recentTrips: (recentTrips || []).map((t: any) => ({
        date: t.trip_date,
        route: t.route,
        client: t.client,
        amount: parseFloat(t.amount),
      })),
    });
  })
);

export default router;
