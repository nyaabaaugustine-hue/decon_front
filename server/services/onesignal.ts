import { DefaultApi, createConfiguration, Notification } from '@onesignal/node-onesignal';

const APP_ID = process.env.ONESIGNAL_APP_ID || '';
const REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY || '';
const enabled = !!(APP_ID && REST_API_KEY);

let client: DefaultApi | null = null;

function getClient(): DefaultApi {
  if (!client) {
    const config = createConfiguration({ restApiKey: REST_API_KEY });
    client = new DefaultApi(config);
  }
  return client;
}

export function isOneSignalEnabled(): boolean {
  return enabled;
}

export async function sendPush(
  userId: string,
  title: string,
  message: string,
  url?: string,
  data?: Record<string, string>,
): Promise<boolean> {
  if (!enabled) return false;

  try {
    const notification = new Notification();
    notification.app_id = APP_ID;
    notification.contents = { en: message };
    notification.headings = { en: title };
    notification.include_aliases = { external_id: [userId] };
    notification.target_channel = 'push';
    if (url) notification.url = url;
    if (data) notification.data = data;

    const result = await getClient().createNotification(notification);
    return !!result.id;
  } catch (err) {
    console.warn(`[onesignal] push failed for user ${userId}:`, err);
    return false;
  }
}
