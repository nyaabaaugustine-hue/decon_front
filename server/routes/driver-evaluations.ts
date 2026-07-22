import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const COLUMNS = [
  'id', 'driver_id', 'evaluator_name', 'evaluation_date', 'period', 'safety_score',
  'punctuality_score', 'driving_skill_score', 'overall_score', 'strengths', 'improvements',
  'comments', 'status', 'created_at', 'updated_at',
];

const COLUMNS_SQL = COLUMNS.join(', ');

// GET /api/driver-evaluations — list all
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(
      `SELECT de.*, d.full_name AS driver_name FROM driver_evaluations de JOIN drivers d ON d.id = de.driver_id ORDER BY de.evaluation_date DESC LIMIT $1`,
      [limit]
    );
    res.json(rows);
  })
);

// GET /api/driver-evaluations/driver/:driverId — list for one driver
router.get(
  '/driver/:driverId',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 1000);
    const rows = await query(
      `SELECT de.*, d.full_name AS driver_name FROM driver_evaluations de JOIN drivers d ON d.id = de.driver_id WHERE de.driver_id = $1 ORDER BY de.evaluation_date DESC LIMIT $2`,
      [req.params.driverId, limit]
    );
    res.json(rows);
  })
);

// POST /api/driver-evaluations — create
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['driverId', 'evaluationDate']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = randomUUID();
    const toInt = (v: any) => (v !== undefined && v !== '' && v !== null ? parseInt(String(v)) : null);
    const created = await executeReturning(
      `INSERT INTO driver_evaluations (id, driver_id, evaluator_name, evaluation_date, period, safety_score, punctuality_score, driving_skill_score, overall_score, strengths, improvements, comments, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING ${COLUMNS_SQL}`,
      [id, b.driverId, b.evaluatorName ?? null, b.evaluationDate, b.period ?? null, toInt(b.safetyScore), toInt(b.punctualityScore), toInt(b.drivingSkillScore), toInt(b.overallScore), b.strengths ?? null, b.improvements ?? null, b.comments ?? null, b.status ?? null]
    );
    res.status(201).json(created);
  })
);

// PUT /api/driver-evaluations/:id — update
router.put(
  '/:id',
  requireRole('admin', 'manager'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const existing = await queryOne(`SELECT ${COLUMNS_SQL} FROM driver_evaluations WHERE id = $1`, [req.params.id]);
    if (!existing) {
      res.status(404).json({ error: 'Driver evaluation not found' });
      return;
    }

    const columnMap: Record<string, string> = {
      evaluatorName: 'evaluator_name',
      evaluationDate: 'evaluation_date',
      period: 'period',
      safetyScore: 'safety_score',
      punctualityScore: 'punctuality_score',
      drivingSkillScore: 'driving_skill_score',
      overallScore: 'overall_score',
      strengths: 'strengths',
      improvements: 'improvements',
      comments: 'comments',
      status: 'status',
    };

    const toInt = (v: any) => (v !== undefined && v !== '' && v !== null ? parseInt(String(v)) : null);

    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, column] of Object.entries(columnMap)) {
      if (req.body[key] !== undefined) {
        fields.push(`${column} = $${paramIndex}`);
        let val = req.body[key];
        if (key === 'safetyScore' || key === 'punctualityScore' || key === 'drivingSkillScore' || key === 'overallScore') {
          val = toInt(val);
        }
        values.push(val);
        paramIndex++;
      }
    }

    if (fields.length > 0) {
      fields.push(`updated_at = NOW()`);
      values.push(req.params.id);
      const updated = await executeReturning(
        `UPDATE driver_evaluations SET ${fields.join(', ')} WHERE id = $${paramIndex}
         RETURNING ${COLUMNS_SQL}`,
        values
      );
      res.json(updated);
      return;
    }

    res.json(existing);
  })
);

// DELETE /api/driver-evaluations/:id — delete (admin only)
router.delete(
  '/:id',
  requireRole('admin'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const result = await execute(`DELETE FROM driver_evaluations WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Driver evaluation not found' });
      return;
    }
    res.status(204).send();
  })
);

export default router;
