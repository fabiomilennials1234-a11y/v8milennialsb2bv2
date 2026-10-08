import { admitReceipt, skipDisabledGroupUpdate } from '../_shared/whatsapp-ingress-inbox.ts';
import { withSecurityHeaders } from '../_shared/security-headers.ts';
import type { WhatsAppWebhookOptions } from './handler.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const response = (status: number, error?: string) => new Response(
  JSON.stringify(error ? { error } : { accepted: true }), {
    status,
    headers: withSecurityHeaders({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      ...(status === 503 ? { 'Retry-After': '5' } : {}) }),
  },
);

function parseInstanceIds(raw: string | undefined, key: string): Set<string> {
  if (!raw) return new Set();
  const ids = raw.split(',').map(id => id.trim());
  if (ids.some(id => !UUID.test(id))) throw new Error(`${key} requires database instance UUIDs`);
  return new Set(ids);
}

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
  const executionIds = parseInstanceIds(getEnv('WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS'), 'WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS');
  if (enabled === 'true' && !getEnv('WHATSAPP_EDGE_INBOX_INSTANCE_IDS')) {
    throw new Error('WHATSAPP_EDGE_INBOX_INSTANCE_IDS requires database instance UUIDs');
  }
  const instanceIds = enabled === 'true'
    ? parseInstanceIds(getEnv('WHATSAPP_EDGE_INBOX_INSTANCE_IDS'), 'WHATSAPP_EDGE_INBOX_INSTANCE_IDS')
    : new Set<string>();

  return async context => {
    if (context.event !== 'messages_update') return null;
    if (executionIds.has(context.instance.id)) {
      try {
        if (await skipDisabledGroupUpdate(context.supabase, context.instance.organization_id, context.payload)) return response(200);
        const { data, error } = await context.supabase.rpc('begin_whatsapp_edge_execution', {
          p_organization_id: context.instance.organization_id,
          p_instance_id: context.instance.id,
          p_payload: context.payload,
          p_path_instance_id: context.pathInstanceId ?? null,
        });
        if (error || !data || typeof data !== 'object' || Array.isArray(data)) return response(503, 'execution_gate_unavailable');
        if (data.mode === 'queued' && typeof data.event_id === 'string' && UUID.test(data.event_id)) return response(200);
        if (data.mode !== 'inline' || typeof data.ticket_id !== 'string' || !UUID.test(data.ticket_id)) {
          return response(503, 'execution_gate_unavailable');
        }
        const ticketId = data.ticket_id;
        return {
          kind: 'inline' as const,
          complete: async () => {
            const settled = await context.supabase.rpc('complete_whatsapp_edge_execution', {
              p_organization_id: context.instance.organization_id,
              p_instance_id: context.instance.id,
              p_ticket_id: ticketId,
            });
            if (settled.error || settled.data !== true) throw new Error('execution_settlement_failed');
          },
        };
      } catch { return response(503, 'execution_gate_unavailable'); }
    }
    if (!instanceIds.has(context.instance.id)) return null;
    // Identity comes from the authenticated handler's database lookup. Keep the
    // whole parsed provider envelope; the worker performs canonical normalization.
    return await admitReceipt(context);
  };
}
