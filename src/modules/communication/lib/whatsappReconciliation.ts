import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { normalizePhone } from '@/lib/normalizePhone';
import { resolveChipInstanceIds } from './chipInstanceIds';
import { WHATSAPP_MESSAGE_COLUMNS, isPersistedMessage, type FetchConversationMessagesParams } from './whatsappMessagesQuery';
import { upsertRealtimeMessage, isOptimisticMessage } from '@/modules/communication/hooks/chat/shared/optimistic-messages';
import type { WhatsAppMessage } from '@/modules/communication/hooks/chat/types';

export interface ThreadSnapshot { fingerprint: string; revisions: Record<string, string> }
export function compareMessages(a: WhatsAppMessage, b: WhatsAppMessage) {
  const fraction = (v: string) => (v.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0');
  return Date.parse(a.timestamp) - Date.parse(b.timestamp)
    || fraction(a.timestamp).localeCompare(fraction(b.timestamp)) || a.id.localeCompare(b.id);
}
export function mergeMessagePages(existing: WhatsAppMessage[], fetched: WhatsAppMessage[]) {
  const rows = new Map(existing.map(m => [m.id, m]));
  const providerIds = new Map(existing.filter(m => m.message_id).map(m => [m.message_id, m.id]));
  for (const message of fetched) {
    const previousId = providerIds.get(message.message_id);
    if (previousId && previousId !== message.id) rows.delete(previousId);
    rows.set(message.id, message);
    if (message.message_id) providerIds.set(message.message_id, message.id);
  }
  // Match only the small optimistic subset, not the whole loaded history.
  const optimistic = [...rows.values()].filter(isOptimisticMessage);
  const persisted = [...rows.values()].filter(m => !isOptimisticMessage(m));
  let unmatched = optimistic;
  for (const message of persisted) {
    if (!unmatched.length) break;
    unmatched = upsertRealtimeMessage(unmatched, message).filter(isOptimisticMessage);
  }
  return [...persisted, ...unmatched].sort(compareMessages);
}

/** Preserve only patches that arrived after the request started. */
export function mergeConcurrentMessages(before: WhatsAppMessage[], fetched: WhatsAppMessage[], live: WhatsAppMessage[]) {
  const original = new Map(before.map(m => [m.id, m]));
  const liveIds = new Set(live.map(m => m.id));
  return mergeMessagePages(fetched.filter(m => !original.has(m.id) || liveIds.has(m.id)),
    live.filter(m => original.get(m.id) !== m));
}

/** The manifest includes the entire loaded range, so backfilled rows and deletes
 * are reconciled too. No monotonic transaction watermark (commits can reorder). */
export async function reconcileConversation(
  params: FetchConversationMessagesParams, existing: WhatsAppMessage[], previous?: ThreadSnapshot,
): Promise<{ messages: WhatsAppMessage[]; snapshot: ThreadSnapshot }> {
  const phone = normalizePhone(params.phoneNumber);
  if (!phone) return { messages: [], snapshot: { fingerprint: "", revisions: {} } };
  const ids = await resolveChipInstanceIds(params.organizationId, params.instanceId);
  const oldest = existing.filter(isPersistedMessage).sort(compareMessages)[0];
  const db: SupabaseClient = supabase;
  const { data, error } = await db.rpc('whatsapp_thread_manifest', {
    p_organization_id: params.organizationId, p_instance_ids: [...ids], p_phone: phone,
    p_since_timestamp: oldest?.timestamp ?? null, p_since_id: oldest?.id ?? null,
    p_fingerprint: previous?.fingerprint ?? null,
  });
  if (error) throw error;
  if (!data || typeof data.fingerprint !== 'string') throw new Error('Não foi possível reconciliar a conversa');
  if (data.unchanged === true && previous) return { messages: existing, snapshot: previous };
  if (!Array.isArray(data.manifest) || data.manifest.some((m: { id?: unknown; revision?: unknown }) =>
    !m || typeof m.id !== 'string' || typeof m.revision !== 'string')) throw new Error('Versões de mensagens inválidas');
  const entries = data.manifest as { id: string; revision: string }[];
  const revisions = Object.fromEntries(entries.map(m => [m.id, m.revision]));
  const present = new Set(existing.map(m => m.id));
  const changed = entries.filter(m => !present.has(m.id) || previous?.revisions[m.id] !== m.revision).map(m => m.id);
  const fetched: WhatsAppMessage[] = [];
  for (let offset = 0; offset < changed.length; offset += 100) {
    const result = await supabase.from('whatsapp_messages').select(WHATSAPP_MESSAGE_COLUMNS)
      .eq('organization_id', params.organizationId).in('instance_id', [...ids])
      .eq('normalized_phone', phone).in('id', changed.slice(offset, offset + 100));
    if (result.error) throw result.error;
    fetched.push(...result.data as unknown as WhatsAppMessage[]);
  }
  const visibleIds = new Set(entries.map(m => m.id));
  const retained = existing.filter(m => visibleIds.has(m.id) || isOptimisticMessage(m));
  return { messages: mergeMessagePages(retained, fetched), snapshot: { fingerprint: data.fingerprint, revisions } };
}
