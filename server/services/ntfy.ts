const NTFY_BASE_URL = process.env.NTFY_BASE_URL || 'https://ntfy.sh';
const NTFY_APP_PREFIX = process.env.NTFY_APP_PREFIX || 'degoony-fleet';
let enabled = !!(NTFY_BASE_URL && NTFY_APP_PREFIX);

export function getTopic(userId: string): string {
  return `${NTFY_APP_PREFIX}-user-${userId}`;
}

export function isNtfyEnabled(): boolean {
  return enabled;
}

export async function send(
  userId: string,
  title: string,
  message: string,
  priority = 3,
  tags: string[] = [],
  clickUrl?: string
): Promise<boolean> {
  if (!enabled) return false;
  const topic = getTopic(userId);
  const headers: Record<string, string> = {
    'Title': title,
    'Priority': String(priority),
  };
  if (tags.length) headers['Tags'] = tags.join(',');
  if (clickUrl) headers['Click'] = clickUrl;

  try {
    const res = await fetch(`${NTFY_BASE_URL}/${topic}`, {
      method: 'POST',
      headers,
      body: message,
    });
    if (!res.ok) {
      console.warn(`[ntfy] push failed for user ${userId}: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[ntfy] push error for user ${userId}:`, err);
    return false;
  }
}
