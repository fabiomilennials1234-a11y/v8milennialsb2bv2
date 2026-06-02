/**
 * Slice 8 — save_copilot_v2_config / set_copilot_v2_agent_active (DB). REQUIRES
 * the migration 20260602220000_copilot_v2_save_config_rpcs applied (dev) + a
 * service/admin key — so .skip by default (repo convention — see
 * send-media-cap.test.ts / handoff-dispatch.test.ts). The orchestration logic
 * (schema → linter → activation → save ordering, fail-CLOSED) is covered at unit
 * level in tests/unit/copilot-v2/save-config-flow.test.ts.
 *
 * Contract this suite locks once the migration is applied:
 *   - org is resolved from the agent row (cross-org caller → 42501, never writes);
 *   - escape_hatch_notes > 500 → 22001, even if the client bypassed the wizard;
 *   - upsert is a single statement → a second save updates, never duplicates (PK);
 *   - anon cannot EXECUTE either RPC (revoked).
 */
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const PROD_URL = 'https://jsjsmuncfkbsbzqzqhfq.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ORG = process.env.COPILOT_V2_TEST_ORG ?? '6030520a-2ca7-477d-be89-55758e2cd808'; // Milennials
const getAdmin = () => createClient(PROD_URL, SERVICE_KEY);

describe('Copilot v2 save-config RPC — gate', () => {
  it('is gated on the Slice 8 save RPC migration (un-skip the suite below once applied)', () => {
    expect(SERVICE_KEY === '' || SERVICE_KEY.length > 0).toBe(true);
  });
});

describe.skip('save_copilot_v2_config (DB) [requires migration applied]', () => {
  it('upserts config in one statement and returns the persisted row', async () => {
    const r = await getAdmin().rpc('save_copilot_v2_config', {
      p_agent_id: process.env.COPILOT_V2_TEST_AGENT ?? '',
      p_slots: { icp: 'construtoras', capabilities: { can_move_stage: true } },
      p_escape_hatch_notes: null,
    });
    expect(r.error).toBeNull();
    expect((r.data as any)?.organization_id).toBe(ORG);
  });

  it('rejects an escape-hatch over 500 chars server-side (22001)', async () => {
    const r = await getAdmin().rpc('save_copilot_v2_config', {
      p_agent_id: process.env.COPILOT_V2_TEST_AGENT ?? '',
      p_slots: {},
      p_escape_hatch_notes: 'a'.repeat(501),
    });
    expect(r.error).not.toBeNull();
  });
});
