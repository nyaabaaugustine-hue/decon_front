import { randomUUID } from 'crypto';
import { execute } from '../db.js';
import { sendPush } from './onesignal.js';

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
  category?: NotifyCategory;
  entityType?: string;
  entityId?: string;
  url?: string;
  data?: Record<string, string>;
}): Promise<void> {
  const {
    userId,
    title,
    message,
    priority = 3,
    category = 'general',
    entityType,
    entityId,
    url,
    data,
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
    sendPush(userId, title, message, url, data),
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
