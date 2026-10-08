import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type QueueHealth = { healthy: boolean; reason: 'ok' | 'disabled' | 'unavailable' | 'paused' | 'dead_letter' | 'expired_lease' | 'stalled' };

/** Metadata only, shared 60s cache. Liveness alone cannot detect a blocked FIFO. */
export function createQueueHealth(db: SupabaseClient, instanceIds: readonly string[], now = Date.now) {
  let cached: QueueHealth | undefined;
  let checkedAt = 0;
  let pending: Promise<QueueHealth> | undefined;
  async function inspect(): Promise<QueueHealth> {
    if (!instanceIds.length) return { healthy: false, reason: 'disabled' };
    for (const instanceId of instanceIds) {
      const instance = await db.from('whatsapp_instances').select('organization_id').eq('id', instanceId).maybeSingle();
      if (instance.error || !instance.data?.organization_id) return { healthy: false, reason: 'unavailable' };
      const org = instance.data.organization_id;
      const result = await db.rpc('get_whatsapp_ingress_handoff_snapshot', { p_organization_id: org, p_instance_id: instanceId });
      const value = Array.isArray(result.data) && result.data.length === 1 ? result.data[0] : null;
      if (result.error || !value || typeof value.paused !== 'boolean'
        || ['dead_letter_count', 'expired_count', 'pending_count', 'processing_count'].some(key => !Number.isSafeInteger(value[key]) || value[key] < 0)) {
        return { healthy: false, reason: 'unavailable' };
      }
      if (value.dead_letter_count) return { healthy: false, reason: 'dead_letter' };
      if (value.expired_count) return { healthy: false, reason: 'expired_lease' };
      if (value.paused) return { healthy: false, reason: 'paused' };
      if (value.pending_count) {
        // Deferred unmatched receipts have their own five-minute grace policy.
        const oldest = await db.from('whatsapp_ingress_events').select('created_at')
          .eq('organization_id', org).eq('instance_id', instanceId).eq('status', 'pending')
          .eq('receipt_deferred', false).order('created_at', { ascending: true }).limit(1).maybeSingle();
        if (oldest.error) return { healthy: false, reason: 'unavailable' };
        if (oldest.data) {
          const age = now() - Date.parse(oldest.data.created_at);
          if (!Number.isFinite(age)) return { healthy: false, reason: 'unavailable' };
          if (age > 300_000) return { healthy: false, reason: 'stalled' };
        }
      }
    }
    return { healthy: true, reason: 'ok' };
  }
  return async (): Promise<QueueHealth> => {
    if (cached && now() - checkedAt >= 0 && now() - checkedAt < 60_000) return cached;
    if (!pending) pending = inspect().catch((): QueueHealth => ({ healthy: false, reason: 'unavailable' }))
      .then(value => { cached = value; checkedAt = now(); return value; }).finally(() => { pending = undefined; });
    return pending;
  };
}
