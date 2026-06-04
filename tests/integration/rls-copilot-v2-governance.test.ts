// @vitest-environment node
/**
 * RLS integration tests — W10 cost governance + kill-switch tables.
 *
 * Validates tenant isolation for the two tables W10 adds:
 *   - copilot_v2_cost_ledger  (org-scoped SELECT, writes deny-all → RPC only)
 *   - copilot_v2_org_pause    (org-scoped SELECT, writes via admin-guarded RPC)
 *
 * Proven live against dev before commit; this is the CI regression guard.
 *
 * Seed assumptions (supabase/seed.sql): Org A = TEST_ORG_ID with admin@/member1@,
 * Org B = TEST_ORG_B_ID with adminb@. Prereq: `supabase start` + `db reset`
 * (applies migration 20260603150000 — the W10 tables + RPCs).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  getOrgAAdmin,
  getOrgAMember1,
  getOrgBAdmin,
  clearClients,
  createServiceClient,
} from './rls-helpers';
import { TEST_ORG_ID, TEST_ORG_B_ID } from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const PAST = '2020-01-01T00:00:00.000Z'; // expired pause — never actually blocks
const LEDGER_DATE = '2026-06-01';

async function countFor(client: SupabaseClient, table: string, orgId?: string): Promise<number> {
  let q = client.from(table).select('organization_id', { count: 'exact', head: true });
  if (orgId) q = q.eq('organization_id', orgId);
  const { count, error } = await q;
  if (error) throw new Error(`SELECT ${table} failed: ${error.message} (${error.code})`);
  return count ?? 0;
}

describe.skipIf(shouldSkip)('RLS: Copilot v2 W10 governance tables', () => {
  let svc: SupabaseClient;

  beforeAll(async () => {
    svc = createServiceClient();
    // Seed one ledger + one pause row for EACH org (service bypasses RLS).
    await svc.from('copilot_v2_cost_ledger').upsert([
      { organization_id: TEST_ORG_ID, period_date: LEDGER_DATE, cost_usd: 0.01, prompt_tokens: 1000, completion_tokens: 500, turn_count: 1 },
      { organization_id: TEST_ORG_B_ID, period_date: LEDGER_DATE, cost_usd: 0.02, prompt_tokens: 2000, completion_tokens: 800, turn_count: 1 },
    ]);
    await svc.from('copilot_v2_org_pause').upsert([
      { organization_id: TEST_ORG_ID, paused_until: PAST, reason: 'takeover' },
      { organization_id: TEST_ORG_B_ID, paused_until: PAST, reason: 'teto' },
    ]);
  });

  afterAll(async () => {
    await svc.from('copilot_v2_org_pause').delete().in('organization_id', [TEST_ORG_ID, TEST_ORG_B_ID]);
    await svc.from('copilot_v2_cost_ledger').delete().in('organization_id', [TEST_ORG_ID, TEST_ORG_B_ID]);
    await clearClients();
  });

  describe('cost_ledger — org-scoped SELECT', () => {
    it('Org A member sees only Org A rows', async () => {
      const a = await getOrgAMember1();
      expect(await countFor(a, 'copilot_v2_cost_ledger', TEST_ORG_ID)).toBe(1);
      expect(await countFor(a, 'copilot_v2_cost_ledger', TEST_ORG_B_ID)).toBe(0);
      expect(await countFor(a, 'copilot_v2_cost_ledger')).toBe(1); // no cross-org leak
    });

    it('Org B admin sees only Org B rows', async () => {
      const b = await getOrgBAdmin();
      expect(await countFor(b, 'copilot_v2_cost_ledger', TEST_ORG_B_ID)).toBe(1);
      expect(await countFor(b, 'copilot_v2_cost_ledger', TEST_ORG_ID)).toBe(0);
    });
  });

  describe('org_pause — org-scoped SELECT', () => {
    it('Org A member sees only Org A pause, not Org B', async () => {
      const a = await getOrgAMember1();
      expect(await countFor(a, 'copilot_v2_org_pause', TEST_ORG_ID)).toBe(1);
      expect(await countFor(a, 'copilot_v2_org_pause', TEST_ORG_B_ID)).toBe(0);
    });
  });

  describe('writes are deny-all (no INSERT/UPDATE/DELETE policy → RPC only)', () => {
    it('Org A member cannot INSERT into cost_ledger', async () => {
      const a = await getOrgAMember1();
      const { error } = await a.from('copilot_v2_cost_ledger')
        .insert({ organization_id: TEST_ORG_ID, period_date: '2099-01-01', cost_usd: 5 });
      expect(error).not.toBeNull();
    });

    it('Org A member cannot INSERT into org_pause', async () => {
      const a = await getOrgAMember1();
      const { error } = await a.from('copilot_v2_org_pause')
        .insert({ organization_id: TEST_ORG_ID, paused_until: PAST, reason: 'takeover' });
      expect(error).not.toBeNull();
    });
  });

  describe('copilot_v2_set_org_pause — admin-guarded + cross-org isolation', () => {
    it('Org A admin CAN pause own org', async () => {
      const admin = await getOrgAAdmin();
      const { error } = await admin.rpc('copilot_v2_set_org_pause', {
        p_org_id: TEST_ORG_ID, p_until: PAST, p_reason: 'takeover', p_paused_by: null,
      });
      expect(error).toBeNull();
    });

    it('Org A admin CANNOT pause another org (42501)', async () => {
      const admin = await getOrgAAdmin();
      const { error } = await admin.rpc('copilot_v2_set_org_pause', {
        p_org_id: TEST_ORG_B_ID, p_until: PAST, p_reason: 'takeover', p_paused_by: null,
      });
      expect(error).not.toBeNull();
    });

    it('Org A MEMBER (non-admin) CANNOT pause own org', async () => {
      const member = await getOrgAMember1();
      const { error } = await member.rpc('copilot_v2_set_org_pause', {
        p_org_id: TEST_ORG_ID, p_until: PAST, p_reason: 'takeover', p_paused_by: null,
      });
      expect(error).not.toBeNull();
    });
  });
});
