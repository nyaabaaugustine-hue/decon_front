import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../validate.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

const MAX_LIMIT = 100;

/**
 * GET /api/search-history
 *
 * Returns recent search queries. Authenticated users see their own history;
 * admins can optionally view all by passing ?all=true.
 *
 * Query params:
 *   ?limit=20   — page size (default 20, max 100)
 *   ?all=true   — (admin only) show searches from all users
 *   ?popular=true — return most popular searches instead of recent ones
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), MAX_LIMIT);
    const showAll = req.query.all === 'true';
    const popular = req.query.popular === 'true';
    const user = (req as any).user;

    let sql: string;
    let params: any[];

    if (popular) {
      // Most popular search terms across users
      sql = `SELECT query, COUNT(*) AS search_count, MAX(created_at) AS last_searched
             FROM search_history
             GROUP BY query
             ORDER BY search_count DESC, last_searched DESC
             LIMIT $1`;
      params = [limit];
    } else if (showAll && user?.role === 'admin') {
      // All users' recent searches (admin only)
      sql = `SELECT sh.id, sh.query, sh.result_count, sh.entity_type, sh.created_at,
                    au.display_name AS user_name
             FROM search_history sh
             LEFT JOIN admin_users au ON au.id = sh.user_id
             ORDER BY sh.created_at DESC
             LIMIT $1`;
      params = [limit];
    } else {
      // Current user's recent searches
      sql = `SELECT id, query, result_count, entity_type, created_at
             FROM search_history
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT $2`;
      params = [user.userId, limit];
    }

    const rows = await query(sql, params);
    res.json(rows);
  })
);

export default router;
