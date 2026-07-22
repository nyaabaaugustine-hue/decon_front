import { Router } from 'express';
import { query, execute } from '../db.js';
import { asyncHandler } from '../validate.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

const MAX_LIMIT = 100;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 500;

/**
 * POST /api/search
 *
 * Full-text search across vehicles, drivers, documents, and revenue entries.
 * Uses the FTS and trigram indexes created during schema initialization.
 *
 * Request body:
 *   { q: "search term", limit?: number, types?: string[] }
 *
 * The `types` array filters which entity types to search.
 * Default (empty or omitted): searches all types.
 * Supported types: vehicles, drivers, documents, revenue
 *
 * Response:
 *   { results: [...], total: number, query: string }
 *
 * Every search is logged to the search_history table for analytics.
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const rawQuery = (req.body?.q || '').trim().slice(0, MAX_QUERY_LENGTH);
    const limit = Math.min(Math.max(parseInt(req.body?.limit as string) || 20, 1), MAX_LIMIT);
    const types = Array.isArray(req.body?.types) ? req.body.types : [];
    const user = (req as any).user;
    const userId = user?.userId || null;

    if (rawQuery.length < MIN_QUERY_LENGTH) {
      res.status(400).json({ error: `Query must be at least ${MIN_QUERY_LENGTH} characters` });
      return;
    }

    const searchTerm = rawQuery;
    const tsquery = searchTerm.split(/\s+/).map((w: string) => w + ':*').join(' & ');

    const results: { type: string; data: any; rank: number }[] = [];
    const searchAll = types.length === 0;

    // ── 1. Search vehicles (plate trigram + make/model FTS) ──────────────────
    if (searchAll || types.includes('vehicles')) {
      const vehicles = await query(`
        SELECT id, plate_number, make, model, year, status,
          ts_rank(to_tsvector('english', make || ' ' || model), to_tsquery('english', $1)) AS rank
        FROM vehicles
        WHERE deleted_at IS NULL
          AND (
            plate_number ILIKE '%' || $2 || '%'
            OR vin ILIKE '%' || $2 || '%'
            OR to_tsvector('english', make || ' ' || model) @@ to_tsquery('english', $1)
          )
        ORDER BY
          CASE WHEN plate_number ILIKE $2 || '%' THEN 0
               WHEN plate_number ILIKE '%' || $2 || '%' THEN 1
               ELSE 2 END,
          rank DESC
        LIMIT $3
      `, [tsquery, searchTerm, limit]);

      for (const v of vehicles) {
        results.push({ type: 'vehicle', data: v, rank: v.rank ?? 0 });
      }
    }

    // ── 2. Search drivers (name trigram + license trigram) ───────────────────
    if (searchAll || types.includes('drivers')) {
      const drivers = await query(`
        SELECT id, full_name, phone, license_number, status,
          similarity(full_name, $2) AS sim
        FROM drivers
        WHERE deleted_at IS NULL
          AND (
            full_name ILIKE '%' || $2 || '%'
            OR license_number ILIKE '%' || $2 || '%'
            OR phone ILIKE '%' || $2 || '%'
          )
        ORDER BY
          CASE WHEN full_name ILIKE $2 || '%' THEN 0
               WHEN license_number ILIKE $2 || '%' THEN 1
               ELSE 2 END,
          sim DESC
        LIMIT $3
      `, [tsquery, searchTerm, limit]);

      for (const d of drivers) {
        results.push({ type: 'driver', data: d, rank: d.sim ?? 0 });
      }
    }

    // ── 3. Search documents (FTS on search_vector) ───────────────────────────
    if (searchAll || types.includes('documents')) {
      const docs = await query(`
        SELECT vd.id, vd.vehicle_id, vd.doc_type, vd.file_name, vd.issue_date, vd.expiry_date, vd.notes,
          v.plate_number,
          ts_rank(vd.search_vector, to_tsquery('english', $1)) AS rank
        FROM vehicle_documents vd
        JOIN vehicles v ON v.id = vd.vehicle_id
        WHERE vd.search_vector @@ to_tsquery('english', $1)
        ORDER BY rank DESC
        LIMIT $2
      `, [tsquery, limit]);

      for (const doc of docs) {
        results.push({ type: 'document', data: doc, rank: doc.rank ?? 0 });
      }
    }

    // ── 4. Search revenue entries (client/route FTS) ─────────────────────────
    if (searchAll || types.includes('revenue')) {
      const revenues = await query(`
        SELECT re.id, re.vehicle_id, re.driver_id, re.trip_date, re.trip_reference,
          re.route, re.client, re.amount, v.plate_number,
          ts_rank(to_tsvector('english', re.client || ' ' || re.route), to_tsquery('english', $1)) AS rank
        FROM revenue_entries re
        JOIN vehicles v ON v.id = re.vehicle_id
        WHERE to_tsvector('english', re.client || ' ' || re.route) @@ to_tsquery('english', $1)
        ORDER BY rank DESC
        LIMIT $2
      `, [tsquery, limit]);

      for (const r of revenues) {
        results.push({ type: 'revenue', data: r, rank: r.rank ?? 0 });
      }
    }

    // ── Sort all results by rank descending ──────────────────────────────────
    results.sort((a, b) => b.rank - a.rank);
    const topResults = results.slice(0, limit);

    // ── Log to search_history ────────────────────────────────────────────────
    const resultCount = topResults.length;
    const entityTypes = [...new Set(topResults.map(r => r.type))].join(',');
    await execute(
      `INSERT INTO search_history (user_id, query, result_count, entity_type) VALUES ($1, $2, $3, $4)`,
      [userId, searchTerm, resultCount, entityTypes || null]
    );

    res.json({
      results: topResults,
      total: resultCount,
      query: searchTerm,
    });
  })
);

export default router;
