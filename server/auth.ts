import crypto from 'crypto';
import { queryOne, query } from './db.js';

export type UserRole = 'admin' | 'manager' | 'viewer';

const ALGO = 'scrypt';
const KEYLEN = 64;
const SALT_LEN = 32;

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt || crypto.randomBytes(SALT_LEN).toString('hex');
  const derived = crypto.scryptSync(password, s, KEYLEN);
  return { hash: `${ALGO}:${s}:${derived.toString('hex')}`, salt: s };
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  const [, salt, expectedHash] = parts;
  const { hash } = hashPassword(password, salt);
  const bufExpected = Buffer.from(expectedHash, 'hex');
  const bufActual = Buffer.from(hash.split(':')[2], 'hex');
  return bufExpected.length === bufActual.length && crypto.timingSafeEqual(bufExpected, bufActual);
}

export function generateToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

// ── Auth cache ────────────────────────────────────────────────────────────────
// Sessions live 7 days; roles change rarely.  A short-TTL in-memory cache
// eliminates the DB round trip entirely for bursts of requests on the same
// token (e.g. FleetDashboard firing Promise.all([getVehicles(), getDrivers()])).
// TTL of 8 seconds is plenty — stale by at most one more page-load cycle.
const AUTH_CACHE_TTL_MS = 8_000;
const authCache = new Map<string, { userId: string; username: string; role: UserRole; mustChangePassword: boolean; expiresAt: number }>();

/** Invalidate cache for a specific token (call on logout, role change, password change). */
export function invalidateAuthCache(token: string) {
  authCache.delete(token);
}

// ── Single-query auth ────────────────────────────────────────────────────────
// One JOIN instead of two sequential queries — ~50% latency cut on the auth
// hot path that every protected request pays.

const AUTH_SQL = `
  SELECT s.user_id, s.username, u.role, u.must_change_password
  FROM sessions s
  JOIN admin_users u ON u.id = s.user_id
  WHERE s.token = $1 AND s.expires_at > NOW()
`;

export async function authenticateRequest(req: any): Promise<{ userId: string; username: string; role: UserRole } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  if (!token || token.length < 10) return null;

  // Check cache first
  const cached = authCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return { userId: cached.userId, username: cached.username, role: cached.role };
  }

  // Cache miss or expired — single JOIN query
  const row = await queryOne<{ user_id: string; username: string; role: string; must_change_password: boolean }>(
    AUTH_SQL,
    [token],
  );

  if (!row) return null;

  const entry = {
    userId: row.user_id,
    username: row.username,
    role: (row.role as UserRole) || 'viewer',
    mustChangePassword: row.must_change_password,
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
  };
  authCache.set(token, entry);

  // Evict stale entries periodically (max 1000 entries — way more than concurrent users)
  if (authCache.size > 1000) {
    const now = Date.now();
    for (const [key, val] of authCache) {
      if (val.expiresAt <= now) authCache.delete(key);
    }
  }

  return { userId: entry.userId, username: entry.username, role: entry.role };
}

/**
 * Same single-query auth check, but returns must_change_password too.
 * Used by the global requirePasswordChanged middleware.
 */
export async function authenticateRequestFull(token: string): Promise<{ userId: string; role: UserRole; mustChangePassword: boolean } | null> {
  // Check cache first
  const cached = authCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return { userId: cached.userId, role: cached.role, mustChangePassword: cached.mustChangePassword };
  }

  const row = await queryOne<{ user_id: string; role: string; must_change_password: boolean }>(
    AUTH_SQL,
    [token],
  );

  if (!row) return null;

  const entry = {
    userId: row.user_id,
    username: '',
    role: (row.role as UserRole) || 'viewer',
    mustChangePassword: row.must_change_password,
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
  };
  authCache.set(token, entry);

  return { userId: entry.userId, role: entry.role, mustChangePassword: entry.mustChangePassword };
}

export function requireAuth(req: any, res: any, next: any) {
  authenticateRequest(req).then((user) => {
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    (req as any).user = user;
    next();
  }).catch(() => {
    res.status(401).json({ error: 'Authentication required' });
  });
}

export function requireRole(...allowed: UserRole[]) {
  return (req: any, res: any, next: any) => {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowed.includes(user.role)) {
      return res.status(403).json({ error: `Requires role: ${allowed.join(' or ')}` });
    }
    next();
  };
}

/**
 * Global middleware that blocks all API access (except auth/login/change-password)
 * when the authenticated user still has `must_change_password = true`.
 *
 * Performs its own token check so it works as a global middleware *before*
 * per-route requireAuth runs.  If no token is present, passes through silently.
 */
export async function requirePasswordChanged(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  if (req.path.startsWith('/api/auth/')) {
    return next();
  }

  const token = authHeader.slice(7);
  if (!token || token.length < 10) {
    return next();
  }

  const auth = await authenticateRequestFull(token);
  if (!auth) return next();

  if (auth.mustChangePassword) {
    return res.status(403).json({
      error: 'Password change required',
      mustChangePassword: true,
    });
  }

  next();
}

export function canWrite(userRole: UserRole): boolean {
  return userRole === 'admin' || userRole === 'manager';
}

export function canDelete(userRole: UserRole): boolean {
  return userRole === 'admin';
}

export async function seedDefaultAdmin(): Promise<void> {
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM admin_users WHERE username = $1',
    ['admin']
  );

  if (!existing) {
    const id = crypto.randomUUID();
    // Use ADMIN_PASSWORD env var if set; otherwise fall back to 'admin'.
    // On Vercel, set ADMIN_PASSWORD in the dashboard for stronger default credentials.
    const initialPassword = process.env.ADMIN_PASSWORD || 'admin';
    const { hash } = hashPassword(initialPassword);
    await query(
      'INSERT INTO admin_users (id, username, password_hash, display_name, role, must_change_password) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, 'admin', hash, 'Administrator', 'admin', true]
    );
    console.log('Default admin user created (admin / <configured password>) — must change password on first login');
  }
}
