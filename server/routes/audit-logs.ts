import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../validate.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const MAX_LIMIT = 200;

/**
 * GET /api/audit-logs
 *
 * View the audit trail. Admin-only.
 *
 * Query params:
 *   ?table=vehicles        — filter by table name
 *   ?operation=UPDATE      — filter by operation type (INSERT, UPDATE, DELETE)
 *   ?limit=50              — page size (default 50, max 200)
 *   ?cursor=<id>           — keyset pagination cursor (audit_log.id)
 *   ?since=<ISO timestamp> — only entries after this time
 */
router.get(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), MAX_LIMIT);
    const cursor = req.query.cursor as string | undefined;
    const tableFilter = req.query.table as string | undefined;
    const operationFilter = req.query.operation as string | undefined;
    const since = req.query.since as string | undefined;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (cursor) {
      conditions.push(`id < $${paramIdx++}`);
      params.push(parseInt(cursor, 10));
    }
    if (tableFilter) {
      conditions.push(`table_name = $${paramIdx++}`);
      params.push(tableFilter);
    }
    if (operationFilter) {
      conditions.push(`operation = $${paramIdx++}`);
      params.push(operationFilter);
    }
    if (since) {
      conditions.push(`created_at >= $${paramIdx++}`);
      params.push(since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT id, table_name, operation, record_id, changed_by, changes, created_at
                 FROM audit_log ${where} ORDER BY id DESC LIMIT $${paramIdx}`;
    params.push(limit + 1);

    const rows = await query(sql, params);
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();

    res.set({
      'X-Has-More': String(hasMore),
      ...(hasMore && rows.length > 0 ? { 'X-Next-Cursor': String(rows[rows.length - 1].id) } : {}),
    });

    res.json(
      rows.map((r: any) => ({
        id: r.id,
        table: r.table_name,
        operation: r.operation,
        recordId: r.record_id,
        changedBy: r.changed_by,
        changes: r.changes,
        createdAt: r.created_at,
      }))
    );
  })
);

/**
 * GET /api/audit-logs/tables
 *
 * Returns the list of distinct table names that have audit entries.
 * Useful for populating a filter dropdown in the UI.
 */
router.get(
  '/tables',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const rows = await query<{ table_name: string }>(
      `SELECT DISTINCT table_name FROM audit_log ORDER BY table_name`
    );
    res.json(rows.map((r) => r.table_name));
  })
);

export default router;
