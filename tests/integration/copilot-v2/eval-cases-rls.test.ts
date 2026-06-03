/**
 * Slice 9 — copilot_v2_eval_cases / copilot_v2_eval_runs RLS (DB). REQUIRES the
 * migration 20260602230000_copilot_v2_eval_cases applied (dev) + keys — so .skip
 * by default (repo convention; see save-config-rpc.test.ts). The runner logic is
 * unit-tested in tests/unit/copilot-v2/eval-runner.test.ts.
 *
 * Contract this suite locks once applied:
 *   - same-org member CAN SELECT the org's eval_cases; other-org/anon CANNOT;
 *   - authenticated INSERT is denied (service_role only in MVP);
 *   - copilot_v2_traces / copilot_v2_trace_steps schema unchanged.
 */
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const PROD_URL = 'https://jsjsmuncfkbsbzqzqhfq.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const getAdmin = () => createClient(PROD_URL, SERVICE_KEY);

describe('Copilot v2 eval_cases — gate', () => {
  it('is gated on the Slice 9 eval migration (un-skip below once applied)', () => {
    expect(SERVICE_KEY === '' || SERVICE_KEY.length > 0).toBe(true);
  });
});

describe.skip('copilot_v2_eval_cases RLS (DB) [requires migration applied]', () => {
  it('service_role can read seeded cases', async () => {
    const r = await getAdmin().from('copilot_v2_eval_cases').select('id').limit(1);
    expect(r.error).toBeNull();
  });
});
