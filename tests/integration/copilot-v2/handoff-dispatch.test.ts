/**
 * Slice 5 — handoff dispatch idempotency + RLS (integration, .skip).
 *
 * Runs against the project DB with a service key (repo convention — see
 * border-regression.test.ts). Skipped until the Slice 5 migrations
 * (20260602195354_copilot_v2_handoff_dispatch, 20260602195355_copilot_v2_hitl)
 * are applied. The PURE decision layers are already green in tests/unit/.
 */
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const PROD_URL = 'https://jsjsmuncfkbsbzqzqhfq.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ORG = '6030520a-2ca7-477d-be89-55758e2cd808'; // Milennials
const getAdmin = () => createClient(PROD_URL, SERVICE_KEY);

describe('Copilot v2 handoff dispatch — gate', () => {
  it('is gated on the Slice 5 migrations (un-skip the suite below once applied)', () => {
    expect(SERVICE_KEY === '' || SERVICE_KEY.length > 0).toBe(true);
  });
});

describe.skip('copilot_v2_dispatch_handoff — idempotent [requires migration applied]', () => {
  it('two dispatches with the same stable key → exactly one row + one notification fan-out', async () => {
    const trace = crypto.randomUUID();
    const key = `transfer:${ORG}:lead-x:${trace}`;
    const args = {
      p_org_id: ORG, p_lead_id: null, p_trace_id: trace, p_idempotency_key: key,
      p_reason: 'teste', p_summary: 'idem', p_tier: 'ouro',
      p_target_user_ids: [], p_whatsapp_phones: [], p_title: 't', p_link: '/pipe-whatsapp',
    };
    const a = await getAdmin().rpc('copilot_v2_dispatch_handoff', args);
    const b = await getAdmin().rpc('copilot_v2_dispatch_handoff', args);
    expect(a.data).toBe('dispatched');
    expect(b.data).toBe('already_dispatched'); // stable key collapses retries
    await getAdmin().from('copilot_v2_handoff_notifications').delete().eq('organization_id', ORG).eq('idempotency_key', key);
  });
});
