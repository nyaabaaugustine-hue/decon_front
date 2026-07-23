import { query, execute, queryOne } from '../db.js';
import { sendNotification } from './notify.js';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

const BUCKETS = [
  { label: 'expired', maxDays: -1, priority: 5 },
  { label: 'expires today', maxDays: 0, priority: 5 },
  { label: 'expires tomorrow', maxDays: 1, priority: 4 },
  { label: 'expires in 3 days', maxDays: 3, priority: 4 },
  { label: 'expires in 7 days', maxDays: 7, priority: 3 },
];

function daysUntil(dateStr: string): number {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return Infinity;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function findBucket(days: number) {
  for (const b of BUCKETS) {
    if (days <= b.maxDays) return b;
  }
  return null;
}

const ALREADY_NOTIFIED_SQL = `
  SELECT key FROM company_settings
  WHERE key LIKE 'expiry_notified_%' AND value = '1'
`;

async function getNotifiedSet(): Promise<Set<string>> {
  const rows = await query<{ key: string }>(ALREADY_NOTIFIED_SQL);
  return new Set(rows.map(r => r.key));
}

async function markNotified(key: string): Promise<void> {
  await execute(
    `INSERT INTO company_settings (id, key, value, category)
     VALUES ($1, $2, '1', 'expiry_tracking')
     ON CONFLICT (key) DO NOTHING`,
    [key, key]
  );
}

function notifiedKey(entityType: string, entityId: string, bucketLabel: string): string {
  return `expiry_notified_${entityType}_${entityId}_${bucketLabel}`;
}

async function getAdminUserIds(): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM admin_users WHERE role IN ('admin', 'manager')`
  );
  return rows.map(r => r.id);
}

interface ExpiryRow {
  id: string;
  label: string;
  entityType: string;
  entityId: string;
  expiryDate: string;
  days: number;
}

async function checkVehicleDocuments(): Promise<ExpiryRow[]> {
  const rows = await query<{ id: string; doc_type: string; plate_number: string; expiry_date: string }>(
    `SELECT d.id, d.doc_type, v.plate_number, d.expiry_date
     FROM vehicle_documents d JOIN vehicles v ON v.id = d.vehicle_id
     WHERE d.expiry_date IS NOT NULL AND d.expiry_date != ''`
  );
  return rows.map(r => ({
    id: r.id,
    label: `${r.doc_type.replace(/_/g, ' ')} — ${r.plate_number}`,
    entityType: 'vehicle_document',
    entityId: r.id,
    expiryDate: r.expiry_date,
    days: daysUntil(r.expiry_date),
  }));
}

async function checkDriverLicenses(): Promise<ExpiryRow[]> {
  const rows = await query<{ id: string; license_number: string; full_name: string; expiry_date: string }>(
    `SELECT l.id, l.license_number, d.full_name, l.expiry_date
     FROM driver_licenses l JOIN drivers d ON d.id = l.driver_id
     WHERE l.expiry_date IS NOT NULL AND l.expiry_date != ''`
  );
  return rows.map(r => ({
    id: r.id,
    label: `License ${r.license_number} — ${r.full_name}`,
    entityType: 'driver_license',
    entityId: r.id,
    expiryDate: r.expiry_date,
    days: daysUntil(r.expiry_date),
  }));
}

async function checkDriverContracts(): Promise<ExpiryRow[]> {
  const rows = await query<{ id: string; full_name: string; end_date: string }>(
    `SELECT c.id, d.full_name, c.end_date
     FROM driver_contracts c JOIN drivers d ON d.id = c.driver_id
     WHERE c.end_date IS NOT NULL AND c.end_date != '' AND c.status = 'active'`
  );
  return rows.map(r => ({
    id: r.id,
    label: `Contract — ${r.full_name}`,
    entityType: 'driver_contract',
    entityId: r.id,
    expiryDate: r.end_date,
    days: daysUntil(r.end_date),
  }));
}

export async function runExpiryCheck(): Promise<void> {
  try {
    const [documents, licenses, contracts, userIds, notified] = await Promise.all([
      checkVehicleDocuments(),
      checkDriverLicenses(),
      checkDriverContracts(),
      getAdminUserIds(),
      getNotifiedSet(),
    ]);

    if (userIds.length === 0) return;

    const all = [...documents, ...licenses, ...contracts];

    for (const item of all) {
      const bucket = findBucket(item.days);
      if (!bucket) continue;

      const key = notifiedKey(item.entityType, item.entityId, bucket.label);
      if (notified.has(key)) continue;

      const title = bucket.label.charAt(0).toUpperCase() + bucket.label.slice(1);
      const message = `${item.label} (${item.expiryDate})`;

      await Promise.all(
        userIds.map(uid =>
          sendNotification({
            userId: uid,
            title,
            message,
            priority: bucket.priority,
            category: 'expiry',
            entityType: item.entityType,
            entityId: item.entityId,
          })
        )
      );

      await markNotified(key);
    }
  } catch (err) {
    console.warn(`[expiry-checker] error:`, err);
  }
}

export function startExpiryChecker(): void {
  if (intervalHandle) return;
  runExpiryCheck();
  intervalHandle = setInterval(runExpiryCheck, CHECK_INTERVAL_MS);
  console.log(`[expiry-checker] started (interval: ${CHECK_INTERVAL_MS / 60000}min)`);
}

export function stopExpiryChecker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
