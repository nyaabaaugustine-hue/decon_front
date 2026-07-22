import { query, execute } from '../db.js';
import { pushNotification } from './gotify.js';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

const SEVEN_DAYS = 7;
const THIRTY_DAYS = 30;

interface ExpiryItem {
  id: string;
  label: string;
  entityType: string;
  entityId: string;
  expiryDate: string;
  daysUntil: number;
}

function daysUntil(dateStr: string): number {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return Infinity;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function daysLabel(days: number): string {
  if (days < 0) return `expired ${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''} ago`;
  if (days === 0) return 'expires today';
  if (days === 1) return 'expires tomorrow';
  return `expires in ${days} days`;
}

function priorityForDays(days: number): number {
  if (days < 0) return 10;
  if (days <= 3) return 8;
  if (days <= 7) return 6;
  return 4;
}

async function checkVehicleDocuments(): Promise<ExpiryItem[]> {
  const rows = await query<{
    id: string; vehicle_id: string; doc_type: string; plate_number: string; expiry_date: string;
  }>(
    `SELECT d.id, d.vehicle_id, d.doc_type, v.plate_number, d.expiry_date
     FROM vehicle_documents d JOIN vehicles v ON v.id = d.vehicle_id
     WHERE d.expiry_date IS NOT NULL AND d.expiry_date != ''`
  );
  const results: ExpiryItem[] = [];
  for (const row of rows) {
    const d = daysUntil(row.expiry_date);
    if (d <= THIRTY_DAYS) {
      results.push({
        id: row.id,
        label: `${row.doc_type.replace(/_/g, ' ')} — ${row.plate_number}`,
        entityType: 'vehicle_document',
        entityId: row.id,
        expiryDate: row.expiry_date,
        daysUntil: d,
      });
    }
  }
  return results;
}

async function checkDriverLicenses(): Promise<ExpiryItem[]> {
  const rows = await query<{
    id: string; driver_id: string; license_number: string; full_name: string; expiry_date: string;
  }>(
    `SELECT l.id, l.driver_id, l.license_number, d.full_name, l.expiry_date
     FROM driver_licenses l JOIN drivers d ON d.id = l.driver_id
     WHERE l.expiry_date IS NOT NULL AND l.expiry_date != ''`
  );
  const results: ExpiryItem[] = [];
  for (const row of rows) {
    const d = daysUntil(row.expiry_date);
    if (d <= THIRTY_DAYS) {
      results.push({
        id: row.id,
        label: `License ${row.license_number} — ${row.full_name}`,
        entityType: 'driver_license',
        entityId: row.id,
        expiryDate: row.expiry_date,
        daysUntil: d,
      });
    }
  }
  return results;
}

async function checkDriverContracts(): Promise<ExpiryItem[]> {
  const rows = await query<{
    id: string; driver_id: string; full_name: string; end_date: string;
  }>(
    `SELECT c.id, c.driver_id, d.full_name, c.end_date
     FROM driver_contracts c JOIN drivers d ON d.id = c.driver_id
     WHERE c.end_date IS NOT NULL AND c.end_date != '' AND c.status = 'active'`
  );
  const results: ExpiryItem[] = [];
  for (const row of rows) {
    const d = daysUntil(row.end_date);
    if (d <= THIRTY_DAYS) {
      results.push({
        id: row.id,
        label: `Contract — ${row.full_name}`,
        entityType: 'driver_contract',
        entityId: row.id,
        expiryDate: row.end_date,
        daysUntil: d,
      });
    }
  }
  return results;
}

function typeForDays(days: number): string {
  if (days < 0) return 'alert';
  if (days <= 7) return 'warning';
  return 'info';
}

async function createAppNotifications(items: ExpiryItem[]): Promise<void> {
  for (const item of items) {
    const title = `${daysLabel(item.daysUntil)}`;
    const message = `${item.label}`;
    const notifType = typeForDays(item.daysUntil);

    await execute(
      `INSERT INTO notifications (id, user_id, title, message, type, category, entity_type, entity_id, is_read)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, false)
       ON CONFLICT DO NOTHING`,
      [
        `expiry-${item.entityType}-${item.id}-${Math.floor(Date.now() / 3600000)}`,
        title, message, notifType, 'expiry',
        item.entityType, item.entityId,
      ]
    );
  }
}

async function sendGotifyNotifications(items: ExpiryItem[]): Promise<void> {
  for (const item of items) {
    const title = `[Fleet] ${daysLabel(item.daysUntil)}`;
    const message = item.label;
    const priority = priorityForDays(item.daysUntil);
    await pushNotification(title, message, priority);
  }
}

export async function runExpiryCheck(): Promise<void> {
  try {
    const allItems = await Promise.all([
      checkVehicleDocuments(),
      checkDriverLicenses(),
      checkDriverContracts(),
    ]);
    const items = allItems.flat();

    if (items.length === 0) return;

    const filtered = items.filter(
      (item) => item.daysUntil <= SEVEN_DAYS || item.daysUntil < 0
    );

    if (filtered.length > 0) {
      await createAppNotifications(filtered);
      await sendGotifyNotifications(filtered);
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
