import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query, queryOne, execute, executeReturning } from '../db.js';
import { requireFields, requireIdParam, asyncHandler } from '../validate.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

const NOTIFICATION_COLUMNS = [
  'id', 'user_id', 'title', 'message', 'type', 'category',
  'entity_type', 'entity_id', 'is_read', 'created_at',
];

const COLUMNS_SQL = NOTIFICATION_COLUMNS.join(', ');

// GET /api/notifications — list notifications for current user
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 1000);
    const rows = await query(
      `SELECT ${COLUMNS_SQL} FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    res.json(rows);
  })
);

// GET /api/notifications/unread-count — count unread for current user
router.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const row = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications WHERE user_id = $1 AND is_read = false`,
      [userId]
    );
    res.json({ count: parseInt(row?.count ?? '0', 10) });
  })
);

// POST /api/notifications — create notification (admin/manager only)
router.post(
  '/',
  requireRole('admin', 'manager'),
  requireFields(['title', 'message']),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = randomUUID();
    const created = await executeReturning(
      `INSERT INTO notifications (id, user_id, title, message, type, category, entity_type, entity_id, is_read)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
       RETURNING ${COLUMNS_SQL}`,
      [id, b.userId ?? null, b.title, b.message, b.type ?? 'info', b.category ?? null, b.entityType ?? null, b.entityId ?? null]
    );
    res.status(201).json(created);
  })
);

// PUT /api/notifications/:id/read — mark as read
router.put(
  '/:id/read',
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const updated = await executeReturning(
      `UPDATE notifications SET is_read = true WHERE id = $1 RETURNING ${COLUMNS_SQL}`,
      [req.params.id]
    );
    if (!updated) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }
    res.json(updated);
  })
);

// PUT /api/notifications/read-all — mark all as read for current user
router.put(
  '/read-all',
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    await execute(
      `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
      [userId]
    );
    res.json({ success: true });
  })
);

// DELETE /api/notifications/:id — delete (admin only)
router.delete(
  '/:id',
  requireRole('admin'),
  requireIdParam(),
  asyncHandler(async (req, res) => {
    const result = await execute(`DELETE FROM notifications WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }
    res.status(204).send();
  })
);

export default router;
