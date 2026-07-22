import crypto from 'crypto';
import { Router } from 'express';
import { queryOne, query } from '../db.js';
import { verifyPassword, generateToken, authenticateRequest, hashPassword, requireAuth, requireRole, invalidateAuthCache } from '../auth.js';
import { asyncHandler } from '../validate.js';
import type { UserRole } from '../auth.js';

const router = Router();

// POST /api/auth/login — returns a session token
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = await queryOne<{ id: string; username: string; password_hash: string; display_name: string; role: string; must_change_password: boolean }>(
    'SELECT id, username, password_hash, display_name, role, must_change_password FROM admin_users WHERE username = $1',
    [username]
  );

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  await query('DELETE FROM sessions WHERE user_id = $1', [user.id]);

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await query(
    'INSERT INTO sessions (id, user_id, username, token, expires_at) VALUES ($1, $2, $3, $4, $5)',
    [crypto.randomUUID(), user.id, user.username, token, expiresAt.toISOString()]
  );

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      mustChangePassword: user.must_change_password,
    },
  });
}));

// GET /api/auth/me — validates token and returns current user
router.get('/me', asyncHandler(async (req, res) => {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const fullUser = await queryOne<{ id: string; username: string; display_name: string; role: string; must_change_password: boolean }>(
    'SELECT id, username, display_name, role, must_change_password FROM admin_users WHERE id = $1',
    [auth.userId]
  );

  if (!fullUser) {
    return res.status(401).json({ error: 'User not found' });
  }

  res.json({
    id: fullUser.id,
    username: fullUser.username,
    displayName: fullUser.display_name,
    role: fullUser.role,
    mustChangePassword: fullUser.must_change_password,
  });
}));

// POST /api/auth/logout — destroys session
router.post('/logout', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    invalidateAuthCache(token);
    await query('DELETE FROM sessions WHERE token = $1', [token]);
  }
  res.json({ ok: true });
}));

// POST /api/auth/change-password — requires current password
router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const user = (req as any).user;

  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new passwords are required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const admin = await queryOne<{ id: string; password_hash: string }>(
    'SELECT id, password_hash FROM admin_users WHERE id = $1',
    [user.userId]
  );

  if (!admin || !verifyPassword(currentPassword, admin.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const { hash: newHash } = hashPassword(newPassword);
  await query('UPDATE admin_users SET password_hash = $1, must_change_password = false WHERE id = $2', [newHash, user.userId]);

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const currentToken = authHeader.slice(7);
    invalidateAuthCache(currentToken);
    await query('DELETE FROM sessions WHERE user_id = $1 AND token != $2', [user.userId, currentToken]);
  }

  res.json({ ok: true });
}));

// ── User management (admin only) ──────────────────────────────────────────────

// GET /api/auth/users — list all users
router.get('/users', requireAuth, requireRole('admin'), asyncHandler(async (_req, res) => {
  const users = await query<{ id: string; username: string; display_name: string; role: string; created_at: string }>(
    'SELECT id, username, display_name, role, created_at FROM admin_users ORDER BY created_at ASC'
  );
  res.json(users.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    createdAt: u.created_at,
  })));
}));

// POST /api/auth/users — create a new user (admin only)
router.post('/users', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { username, password, displayName, role } = req.body || {};

  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'Username, password, and displayName are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const validRoles: UserRole[] = ['admin', 'manager', 'viewer'];
  const userRole: UserRole = validRoles.includes(role as UserRole) ? (role as UserRole) : 'viewer';

  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM admin_users WHERE username = $1',
    [username]
  );
  if (existing) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  const id = crypto.randomUUID();
  const { hash } = hashPassword(password);

  await query(
    'INSERT INTO admin_users (id, username, password_hash, display_name, role, must_change_password) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, username, hash, displayName, userRole, true]
  );

  res.status(201).json({ id, username, displayName, role: userRole });
}));

// PATCH /api/auth/users/:id — update user role or display name (admin only)
router.patch('/users/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { displayName, role } = req.body || {};

  const user = await queryOne<{ id: string }>('SELECT id FROM admin_users WHERE id = $1', [id]);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const updates: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (displayName) {
    updates.push(`display_name = $${idx++}`);
    values.push(displayName);
  }
  if (role && ['admin', 'manager', 'viewer'].includes(role)) {
    updates.push(`role = $${idx++}`);
    values.push(role);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  values.push(id);
  await query(`UPDATE admin_users SET ${updates.join(', ')} WHERE id = $${idx}`, values);

  res.json({ ok: true });
}));

// DELETE /api/auth/users/:id — delete a user (admin only, cannot delete self)
router.delete('/users/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const currentUser = (req as any).user;

  if (id === currentUser.userId) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  const user = await queryOne<{ id: string }>('SELECT id FROM admin_users WHERE id = $1', [id]);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  await query('DELETE FROM admin_users WHERE id = $1', [id]);
  res.json({ ok: true });
}));

// POST /api/auth/users/:id/reset-password — admin resets another user's password
router.post('/users/:id/reset-password', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body || {};

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const user = await queryOne<{ id: string }>('SELECT id FROM admin_users WHERE id = $1', [id]);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const { hash } = hashPassword(newPassword);
  // Admin-reset passwords must also be changed by the user on next login — an admin
  // knowing the new password (even briefly) shouldn't count as that user's real secret.
  await query('UPDATE admin_users SET password_hash = $1, must_change_password = true WHERE id = $2', [hash, id]);
  await query('DELETE FROM sessions WHERE user_id = $1', [id]);

  res.json({ ok: true });
}));

export default router;
