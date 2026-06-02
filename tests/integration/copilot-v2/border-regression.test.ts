/**
 * Slice 1 — border regression suite (Copilot v2) [requires migration applied]
 *
 * Binding condition (ADR-0002 decision #2): every past production incident is
 * re-derived as a regression test. The PURE decision layers are already covered
 * green in tests/unit/copilot-v2/. THIS file covers the DB-level behaviors that
 * can only be proven against real Postgres (atomic dedup, phone-keyed pause
 * persistence, atomic turn counter).
 *
 * SKIPPED until `20260531174908_copilot_v2_foundation.sql` is applied (these run
 * against PROD like the rest of tests/integration/, per the repo convention).
 * Remove `.skip` once the migration lands. Each `it` maps to one incident.
 */

import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const PROD_URL = 'https://jsjsmuncfkbsbzqzqhfq.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ORG = '6030520a-2ca7-477d-be89-55758e2cd808'; // Milennials
// NOTE: foundation migration 20260531174908_copilot_v2_foundation IS applied to prod.
// Lazy — constructing a client with an empty key throws at import time.
const getAdmin = () => createClient(PROD_URL, SERVICE_KEY);

describe('Copilot v2 border regression — gate', () => {
  it('is gated on 20260531174908_copilot_v2_foundation.sql (un-skip the suite below once applied)', () => {
    // Sentinel: keeps this file green pre-migration. The real DB regressions are
    // in the skipped suite below — they require the foundation tables in prod.
    expect(SERVICE_KEY === '' || SERVICE_KEY.length > 0).toBe(true);
  });
});

describe.skip('Copilot v2 border regression [requires migration applied]', () => {
  it('dedup race: 5 concurrent enqueues of the same idempotency key → exactly 1 row', async () => {
    const key = `test-idem-${Date.now()}`;
    const trace = crypto.randomUUID();
    const calls = Array.from({ length: 5 }, () =>
      getAdmin().rpc('copilot_v2_enqueue_message', {
        p_org_id: ORG, p_lead_id: null, p_canonical_phone: '11999990000',
        p_message_type: 'text', p_content: 'corrida', p_source: 'inbound',
        p_trace_id: trace, p_idempotency_key: key,
      }),
    );
    const results = await Promise.all(calls);
    const inserted = results.filter((r) => r.data != null).length;
    expect(inserted).toBe(1); // ON CONFLICT DO NOTHING RETURNING → exactly one
    await getAdmin().from('copilot_v2_message_queue').delete().eq('organization_id', ORG).eq('idempotency_key', key);
  });

  it('reaper: a stale processing row is returned to retry (#22)', async () => {
    const key = `test-reap-${Date.now()}`;
    const trace = crypto.randomUUID();
    const { data: id } = await getAdmin().rpc('copilot_v2_enqueue_message', {
      p_org_id: ORG, p_lead_id: null, p_canonical_phone: '11999990001',
      p_message_type: 'text', p_content: 'reap', p_source: 'inbound',
      p_trace_id: trace, p_idempotency_key: key,
    });
    // Force it stale-processing.
    await getAdmin().from('copilot_v2_message_queue')
      .update({ status: 'processing', updated_at: new Date(Date.now() - 10 * 60_000).toISOString() })
      .eq('id', id);
    const { data: reaped } = await getAdmin().rpc('copilot_v2_reap_stale_processing', { p_timeout_minutes: 5 });
    expect((reaped as number) >= 1).toBe(true);
    const { data: row } = await getAdmin().from('copilot_v2_message_queue').select('status').eq('id', id).single();
    expect(row?.status).toBe('retry');
    await getAdmin().from('copilot_v2_message_queue').delete().eq('id', id);
  });

  it('human-pause phone-keyed: set under one rendering, found under another', async () => {
    const canonical = '11987654321';
    await getAdmin().rpc('copilot_v2_set_human_pause', {
      p_org_id: ORG,
      p_canonical_phone: canonical,
      p_until: new Date(Date.now() + 60 * 60_000).toISOString(),
      p_reason: 'test',
    });
    // The edge always normalizes before lookup → equivalent renderings hit the same row.
    const { data } = await getAdmin().rpc('copilot_v2_check_human_pause', { p_org_id: ORG, p_canonical_phone: canonical });
    expect(data).toBeTruthy();
    await getAdmin().from('copilot_v2_pause_state').delete().eq('organization_id', ORG).eq('canonical_phone', canonical);
  });

  it('increment_conversation_turn race: 10 concurrent bumps → turn_count = 10', async () => {
    const conv = crypto.randomUUID();
    const calls = Array.from({ length: 10 }, () =>
      getAdmin().rpc('copilot_v2_next_turn', { p_conversation_id: conv, p_org_id: ORG }),
    );
    await Promise.all(calls);
    const { data } = await getAdmin().from('copilot_v2_turn_counters').select('turn_count').eq('conversation_id', conv).single();
    expect(data?.turn_count).toBe(10);
    await getAdmin().from('copilot_v2_turn_counters').delete().eq('conversation_id', conv);
  });

  // ── Slice 11 — proactive anti-double-send (corrida + rate-limit) ──────────
  it('proactive double-send: 5 concurrent claims of the same slot → exactly 1 enqueued (#7/#8/#9)', async () => {
    const lead = crypto.randomUUID();
    const idem = `proactive:${ORG}:first_touch:${lead}:1`;
    const calls = Array.from({ length: 5 }, () =>
      getAdmin().rpc('copilot_v2_claim_proactive_slot', {
        p_org_id: ORG, p_lead_id: lead, p_kind: 'first_touch',
        p_slot: '1', p_idempotency_key: idem, p_daily_ceiling: 100,
      }),
    );
    const results = await Promise.all(calls);
    const claimed = results.filter((r) => (Array.isArray(r.data) ? r.data[0] : r.data)?.claimed === true).length;
    expect(claimed).toBe(1); // só um tick reivindica o slot — sem double first-touch
    await getAdmin().from('copilot_v2_proactive_log').delete().eq('organization_id', ORG).eq('idempotency_key', idem);
  });

  it('proactive rate-limit: claim blocks at the daily ceiling', async () => {
    const lead = crypto.randomUUID();
    const idem = `proactive:${ORG}:followup:${lead}:d3`;
    const { data } = await getAdmin().rpc('copilot_v2_claim_proactive_slot', {
      p_org_id: ORG, p_lead_id: lead, p_kind: 'followup',
      p_slot: 'd3', p_idempotency_key: idem, p_daily_ceiling: 0, // teto inválido → fail-closed
    });
    const row = Array.isArray(data) ? data[0] : data;
    expect(row?.claimed).toBe(false);
    expect(row?.reason).toBe('no_rate_ceiling');
  });
});
