import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface InboxEvent {
  id: string;
  organization_id: string;
  instance_id: string;
  event_name: 'messages_update';
  payload: Record<string, unknown>;
  path_instance_id: string | null;
  lease_token: string;
  created_at: string;
}
export async function skipDisabledGroupUpdate(db: SupabaseClient, organizationId: string, payload: Record<string, unknown>): Promise<boolean> {
  const nested = [payload, payload.data, payload.event, payload.message, payload.chat]
    .filter((value): value is Record<string, unknown> => !!value && typeof value === 'object');
  const isGroup = nested.some(value => [value.chatid, value.Chat, value.remoteJid, value.wa_chatid]
    .some(jid => typeof jid === 'string' && jid.endsWith('@g.us')));
  if (!isGroup) return false;
  const { data, error } = await db.from('organizations').select('capture_groups').eq('id', organizationId).maybeSingle();
  // Unknown policy cannot authorize dropping an acknowledged receipt.
  if (error || !data) throw new Error('group_policy_unavailable');
  return data.capture_groups === false;
}

export async function admitReceipt(context: {
  supabase: SupabaseClient; instance: { id: string; organization_id: string };
  event: string; payload: Record<string, unknown>; pathInstanceId?: string;
}): Promise<Response> {
  const respond = (status: number, error?: string) => new Response(JSON.stringify(error ? { error } : { accepted: true }), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(status === 503 ? { 'Retry-After': '5' } : {}) },
  });
  // Provider configuration must route ONLY receipts to this canary. An
  // accidental messages/connection cutover is rejected, never acknowledged.
  if (context.event !== 'messages_update') return respond(503, 'event_not_enabled');
  try {
    if (await skipDisabledGroupUpdate(context.supabase, context.instance.organization_id, context.payload)) return respond(200);
    const { data, error } = await context.supabase.rpc('enqueue_whatsapp_ingress_event', {
      p_organization_id: context.instance.organization_id, p_instance_id: context.instance.id,
      p_event_name: context.event, p_payload: context.payload, p_path_instance_id: context.pathInstanceId ?? null,
    });
    if (error || typeof data !== 'string') return respond(503, 'inbox_unavailable');
    return respond(202); // Only after Postgres committed the durable event.
  } catch { return respond(503, 'inbox_unavailable'); }
}
