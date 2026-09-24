import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { quoteLiveSendEnabled } from '../../supabase/functions/_shared/quotes/live-send.ts';
import { createUazapiFindById, planReceiptRecovery, type ReceiptCandidate, type FindMessageById } from './receipt-recovery.ts';

type CandidateRow = { id: string; message_id: string; remote_jid: string; status: string; created_at: string };
type Batch = { lease_token: string; candidates: CandidateRow[]; has_more: boolean };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface RecoveryReport {
  mode: 'preview' | 'apply';
  state: 'finished' | 'blocked';
  checked: number;
  planned: number;
  enqueued: number;
  inconclusive: number;
  unscanned: number;
  error: number;
  has_more: boolean;
  boundary: 'known_outgoing_status_only';
}

/** A snapshot can repair current status, never the original event or consent time. */
export async function runReceiptRecoveryBatch(db: SupabaseClient, input: {
  organizationId: string; instanceId: string; providerBaseUrl: string; apply?: boolean;
  signal?: AbortSignal; findById?: FindMessageById;
  quoteEnabled?: (organizationId: string) => boolean;
}): Promise<RecoveryReport> {
  const report: RecoveryReport = { mode: input.apply ? 'apply' : 'preview', state: 'blocked',
    checked: 0, planned: 0, enqueued: 0, inconclusive: 0, unscanned: 0, error: 0, has_more: false,
    boundary: 'known_outgoing_status_only' };
  if (!UUID.test(input.organizationId) || !UUID.test(input.instanceId)) throw new Error('Invalid recovery scope');
  // Do not change presentation/consent timing based on a snapshot of provider state.
  if ((input.quoteEnabled ?? quoteLiveSendEnabled)(input.organizationId)) return report;
  const instance = await db.from('whatsapp_instances').select('id,organization_id,provider')
    .eq('id', input.instanceId).eq('organization_id', input.organizationId).maybeSingle();
  if (instance.error || !instance.data || instance.data.provider !== 'uazapi') return report;
  const credentials = await db.rpc('get_uazapi_credentials', { p_instance_id: input.instanceId });
  const credential = Array.isArray(credentials.data) ? (credentials.data.length === 1 ? credentials.data[0] : null) : credentials.data;
  if (credentials.error || !credential || credential.organization_id !== input.organizationId
    || typeof credential.uazapi_token !== 'string' || !credential.uazapi_token) return report;
  const findById = input.findById ?? createUazapiFindById(input.providerBaseUrl, credential.uazapi_token);
  let batch: Batch | null = null;
  let inconclusiveIds: string[] = [];
  let rows: CandidateRow[];
  if (input.apply) {
    const claimed = await db.rpc('begin_whatsapp_receipt_recovery', {
      p_organization_id: input.organizationId, p_instance_id: input.instanceId,
    });
    if (claimed.error || claimed.data === null) return report;
    if (!claimed.data || !UUID.test(claimed.data.lease_token) || !Array.isArray(claimed.data.candidates)
      || claimed.data.candidates.length > 50 || typeof claimed.data.has_more !== 'boolean') throw new Error('Recovery batch unconfirmed');
    batch = claimed.data;
    rows = batch!.candidates;
    report.has_more = batch!.has_more;
  } else {
    const end = new Date();
    const candidates = await db.from('whatsapp_messages').select('id,message_id,remote_jid,status,created_at')
      .eq('organization_id', input.organizationId).eq('instance_id', input.instanceId)
      .eq('direction', 'outgoing').in('status', ['pending', 'sent', 'delivered', 'failed']).is('deleted_at', null)
      .gte('created_at', new Date(end.getTime() - 7 * 86400_000).toISOString()).lt('created_at', end.toISOString())
      .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(51);
    if (candidates.error || !Array.isArray(candidates.data)) return report;
    report.has_more = candidates.data.length > 50;
    rows = candidates.data.slice(0, 50);
  }
  const batchStarted = Date.now();
  try {
    // Malformed/absent identifiers remain an explicit coverage gap.
    const candidates: ReceiptCandidate[] = rows.map(row => ({ organizationId: input.organizationId,
      instanceId: input.instanceId, messageId: typeof row.message_id === 'string' ? row.message_id : '',
      chatId: typeof row.remote_jid === 'string' ? row.remote_jid : '', status: row.status }));
    const result = await planReceiptRecovery({ candidates, findById, signal: input.signal });
    report.checked = result.counts.examined;
    report.planned = result.plans.length;
    report.inconclusive = result.counts.inconclusive;
    report.unscanned = result.counts.unscanned;
    report.error = result.counts.providerError;
    inconclusiveIds = result.inconclusiveIndexes.map(index => rows[index].id);
    if (batch) for (const plan of result.plans) {
      if (input.signal?.aborted || Date.now() - batchStarted >= 90_000) {
        report.error = Math.min(50, report.error + 1); break;
      }
      const targets = rows.filter(row => row.message_id === plan.messageId);
      if (targets.length !== 1 || !UUID.test(targets[0].id)) throw new Error('Ambiguous recovery target');
      const queued = await db.rpc('enqueue_whatsapp_receipt_recovery', {
        p_organization_id: input.organizationId, p_instance_id: input.instanceId,
        p_lease_token: batch.lease_token, p_message_row_id: targets[0].id,
        p_status: plan.status, p_observed_at: plan.observedAt,
      });
      if (queued.error || (queued.data !== null && !UUID.test(queued.data))) {
        // An ambiguous commit is not retried. Next cycle rechecks persisted state.
        throw new Error('Recovery admission unconfirmed');
      }
      if (queued.data !== null) report.enqueued++;
    }
    report.state = 'finished';
  } catch {
    report.error = Math.min(50, report.error + 1);
    report.unscanned = rows.length - report.checked;
    report.state = 'blocked';
  }
  if (batch) {
    const finished = await db.rpc('finish_whatsapp_receipt_recovery', {
      p_organization_id: input.organizationId, p_instance_id: input.instanceId, p_lease_token: batch.lease_token,
      p_inconclusive_ids: inconclusiveIds,
      p_results: { checked: report.checked, planned: report.planned, enqueued: report.enqueued,
        inconclusive: report.inconclusive, unscanned: report.unscanned, error: report.error },
    });
    if (finished.error || finished.data !== true) throw new Error('Recovery checkpoint unconfirmed');
  }
  return report;
}

/** One process, sequential batches. DB lease/checkpoint also fences restarts. */
export function createReceiptRecoveryLoop(db: SupabaseClient, instanceIds: readonly string[], baseUrl: string) {
  const abort = new AbortController();
  let wake: (() => void) | undefined;
  return {
    stop() { abort.abort(); wake?.(); },
    async run() {
      while (!abort.signal.aborted) {
        for (const instanceId of instanceIds) {
          if (abort.signal.aborted) break;
          try {
            const instance = await db.from('whatsapp_instances').select('organization_id').eq('id', instanceId).maybeSingle();
            if (instance.error || !instance.data) throw new Error('Recovery instance unavailable');
            const result = await runReceiptRecoveryBatch(db, { organizationId: instance.data.organization_id,
              instanceId, providerBaseUrl: baseUrl, apply: true, signal: abort.signal });
            if (result.state !== 'finished' || result.error || result.inconclusive || result.unscanned) {
              console.warn('[whatsapp-ingress] receipt recovery coverage incomplete');
            }
          } catch { console.error('[whatsapp-ingress] receipt recovery requires review'); }
        }
        if (!abort.signal.aborted) await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 300_000);
          wake = () => { clearTimeout(timer); resolve(); };
        });
      }
    },
  };
}
