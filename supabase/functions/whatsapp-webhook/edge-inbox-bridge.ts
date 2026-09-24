import { admitReceipt } from '../_shared/whatsapp-ingress-inbox.ts';
import type { WhatsAppWebhookOptions } from './handler.ts';

/** Edge-only composition. The worker must use the plain handler factory so a
 * queued replay cannot enqueue itself. Enabling requires an operational handoff;
 * configuration alone does not establish ordering with in-flight inline work. */
export function createEdgeInboxBridge(
  getEnv: (key: string) => string | undefined,
): NonNullable<WhatsAppWebhookOptions['admitEvent']> {
  const enabled = getEnv('WHATSAPP_EDGE_INBOX_ENABLED') ?? 'false';
  if (enabled !== 'true' && enabled !== 'false') {
    throw new Error('Invalid configuration: WHATSAPP_EDGE_INBOX_ENABLED');
  }
  if (enabled === 'false') return async () => null;

  const instanceIds = new Set(
    (getEnv('WHATSAPP_EDGE_INBOX_INSTANCE_IDS') ?? '').split(',').map(id => id.trim()),
  );
  for (const id of instanceIds) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
      // Do not silently fall back to a second writer after a configuration typo.
      throw new Error('WHATSAPP_EDGE_INBOX_INSTANCE_IDS requires database instance UUIDs');
    }
  }

  return async context => {
    if (context.event !== 'messages_update' || !instanceIds.has(context.instance.id)) return null;
    // Identity comes from the authenticated handler's database lookup. Keep the
    // whole parsed provider envelope; the worker performs canonical normalization.
    return await admitReceipt(context);
  };
}
