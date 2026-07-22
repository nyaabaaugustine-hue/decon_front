import { randomUUID } from 'crypto';
import { execute } from '../db.js';
import { send } from './ntfy.js';

export type NotifyPriority = 1 | 2 | 3 | 4 | 5;
export type NotifyType = 'info' | 'warning' | 'alert' | 'success';
export type NotifyCategory =
  | 'expiry'
  | 'work_order'
  | 'accident'
  | 'maintenance'
  | 'assignment'
  | 'evaluation'
  | 'expense'
  | 'general';

const PRIORITY_TYPE_MAP: Record<number, NotifyType> = {
  5: 'alert',
  4: 'warning',
  3: 'warning',
  2: 'info',
  1: 'info',
};

export async function sendNotification(params: {
  userId: string;
  title: string;
  message: string;
  priority?: NotifyPriority;
  tags?: string[];
  category?: NotifyCategory;
  entityType?: string;
  entityId?: string;
  clickUrl?: string;
}): Promise<void> {
  const {
    userId,
    title,
    message,
    priority = 3,
    tags = [],
    category = 'general',
    entityType,
    entityId,
    clickUrl,
  } = params;

  const notifType: NotifyType = PRIORITY_TYPE_MAP[priority] || 'info';
  const id = randomUUID();

  const insertPromise = execute(
    `INSERT INTO notifications (id, user_id, title, message, type, category, entity_type, entity_id, is_read)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
     ON CONFLICT (id) DO NOTHING`,
    [id, userId, title, message, notifType, category, entityType ?? null, entityId ?? null]
  );

  await Promise.all([
    insertPromise,
    send(userId, title, message, priority, tags, clickUrl),
  ]);
}

export async function markRead(notificationId: string): Promise<void> {
  await execute(
    `UPDATE notifications SET is_read = true WHERE id = $1`,
    [notificationId]
  );
}

export async function markAllRead(userId: string): Promise<void> {
  await execute(
    `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
    [userId]
  );
}
