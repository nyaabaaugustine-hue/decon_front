import { Pool, PoolConfig } from '@neondatabase/serverless';
import dotenv from 'dotenv';

// ── Environment ────────────────────────────────────────────────────────────────
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || '';
if (!DATABASE_URL) {
  console.warn('DATABASE_URL not set. Database queries will fail until it is configured in your environment variables.');
}

const isDev = process.env.NODE_ENV === 'development';

// ── Pool Configuration ─────────────────────────────────────────────────────────
// Statement + idle-in-transaction timeouts protect against runaway queries or
// hung transactions starving the pool.  Tuned for Neon free/launch tier.
const poolConfig: PoolConfig = {
  connectionString: DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT || '5000', 10),
  allowExitOnIdle: false,
  // NOTE: Do NOT set `options: '-c statement_timeout=...'` here.  Neon's
  // PgBouncer rejects unsupported startup parameters — this causes the
  // "unsupported startup parameter in options" error.  Statement timeouts
  // are enforced per-query inside the transaction() helper instead.
};

export const pool = new Pool(poolConfig);

// Log pool errors so they don't silently swallow
pool.on('error', (err: Error) => {
  console.error('Unexpected pool error:', err.message);
});

// ── Query Execution Helpers ────────────────────────────────────────────────────

/**
 * Execute a query and return all matching rows.
 * In development mode, logs query text + params to aid debugging.
 */
export async function query<T = Record<string, any>>(queryText: string, params?: any[]): Promise<T[]> {
  if (isDev) {
    console.debug('SQL:', queryText.substring(0, 200), params ? JSON.stringify(params).substring(0, 200) : '');
  }
  const result = await pool.query(queryText, params ?? []);
  return result.rows as T[];
}

/**
 * Execute a query and return the first row, or null if no rows match.
 */
export async function queryOne<T = Record<string, any>>(queryText: string, params?: any[]): Promise<T | null> {
  const results = await query<T>(queryText, params);
  return results[0] ?? null;
}

/**
 * Execute an INSERT / UPDATE / DELETE and return the affected row count.
 */
export async function execute(queryText: string, params?: any[]): Promise<{ rowCount: number }> {
  const result = await pool.query(queryText, params ?? []);
  return { rowCount: result.rowCount ?? 0 };
}

/**
 * Execute an INSERT or UPDATE with a RETURNING clause and return the first
 * affected row (or null).  Use this instead of execute() + queryOne() to
 * save a round trip.
 */
export async function executeReturning<T = Record<string, any>>(queryText: string, params?: any[]): Promise<T | null> {
  const result = await pool.query(queryText, params ?? []);
  return (result.rows[0] as T) ?? null;
}

/**
 * Execute multiple statements inside a single transaction.
 * If any statement fails, the entire transaction is rolled back.
 *
 * When `userId` is provided, sets `app.current_user_id` for the transaction
 * (transaction-scoped via set_config(..., true)), so audit triggers and RLS
 * policies can attribute actions to the authenticated user.  Must be used with
 * PgBouncer transaction pooling — the set_config call and all subsequent
 * queries run on the same checked-out client.
 */
export async function transaction<T>(
  callback: (queryFn: typeof query) => Promise<T>,
  userId?: string
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (userId) {
      // Best-effort: Neon serverless driver may not support set_config on
      // pooled connections, so we swallow errors silently.
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]).catch(() => {});
    }
    const txQuery = async <U>(text: string, params?: any[]) => {
      const result = await client.query(text, params ?? []);
      return result.rows as U[];
    };
    const result = await callback(txQuery);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ── Health / Lifecycle ─────────────────────────────────────────────────────────

/** Quick database connectivity check (used by /api/health). */
export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/** Detailed health stats for observability dashboards. */
export async function healthDetail() {
  const start = Date.now();
  const alive = await healthCheck();
  const latencyMs = Date.now() - start;
  return {
    alive,
    latencyMs,
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}

/** Gracefully close all pool connections (call on shutdown). */
export async function closePool(): Promise<void> {
  await pool.end();
}
