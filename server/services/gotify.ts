let gotifyUrl = process.env.GOTIFY_URL || '';
let gotifyAppToken = process.env.GOTIFY_APP_TOKEN || '';
let enabled = !!(gotifyUrl && gotifyAppToken);

export function isGotifyEnabled(): boolean {
  return enabled;
}

export function reconfigure(url: string, token: string) {
  gotifyUrl = url;
  gotifyAppToken = token;
  enabled = !!(url && token);
}

export async function pushNotification(
  title: string,
  message: string,
  priority = 5
): Promise<boolean> {
  if (!enabled) return false;
  try {
    const res = await fetch(`${gotifyUrl}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gotify-Key': gotifyAppToken,
      },
      body: JSON.stringify({ title, message, priority }),
    });
    if (!res.ok) {
      console.warn(`[gotify] push failed: ${res.status} ${res.statusText}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[gotify] push error:`, err);
    return false;
  }
}
