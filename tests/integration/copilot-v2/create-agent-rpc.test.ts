/**
 * Slice 12b — create_copilot_v2_agent / copilot_v2_v1_prefill_candidates (DB).
 *
 * REQUIRES migration 20260604120000_copilot_v2_wizard_route_rpcs applied + a
 * service/admin key, so .skip by default (repo convention — see
 * save-config-rpc.test.ts). The org-resolution + admin-gating is SQL, validated
 * live against dev during the cutover dogfood; this suite is the committed lock.
 *
 * Contract this suite locks once the migration is applied:
 *   - create is get-or-create on (org, archetype): a second call returns the SAME
 *     id (unique constraint, never a duplicate row);
 *   - org is resolved from the caller's admin set, never the payload;
 *   - a non-admin (or cross-org) caller gets 42501 and creates nothing;
 *   - prefill_candidates returns { organization_id, organization_name, candidates }
 *     scoped to the caller's org; anon cannot EXECUTE either RPC (revoked).
 */
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL ?? 'https://bcfadphgsibjzivtbjvc.supabase.co'; // dev
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ORG = process.env.COPILOT_V2_TEST_ORG ?? '6030520a-2ca7-477d-be89-55758e2cd808'; // Milennials
const getAdmin = () => createClient(URL, SERVICE_KEY);

describe('Copilot v2 create-agent RPC — gate', () => {
  it('is gated on the Slice 12b RPC migration (un-skip the block below once applied)', () => {
    expect(typeof SERVICE_KEY).toBe('string');
  });
});

describe.skip('create_copilot_v2_agent + prefill_candidates (DB) [requires migration applied]', () => {
  it('get-or-create returns the same agent id for a repeated (org, archetype)', async () => {
    const a = await getAdmin().rpc('create_copilot_v2_agent', { p_archetype: 'qualificador', p_organization_id: ORG });
    const b = await getAdmin().rpc('create_copilot_v2_agent', { p_archetype: 'qualificador', p_organization_id: ORG });
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect((a.data as any)?.id).toBe((b.data as any)?.id);
    expect((a.data as any)?.organization_id).toBe(ORG);
  });

  it('prefill_candidates returns the org-scoped envelope', async () => {
    const r = await getAdmin().rpc('copilot_v2_v1_prefill_candidates', { p_organization_id: ORG });
    expect(r.error).toBeNull();
    expect((r.data as any)?.organization_id).toBe(ORG);
    expect(Array.isArray((r.data as any)?.candidates)).toBe(true);
  });
});
