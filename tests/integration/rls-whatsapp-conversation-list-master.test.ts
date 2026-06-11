// @vitest-environment node
/**
 * Master ghost on the V3 server-side WhatsApp conversation list RPC.
 *
 * Regression for the bug where a MASTER user saw an EMPTY chat conversation list
 * in any client org. The V3 list reads whatsapp_conversation_summary via the RPC
 * get_whatsapp_conversation_list, whose access guard was team_member-only
 * (p_org IN get_my_organization_ids()). A master is not a team_member of the
 * target org, so the guard raised 'forbidden: org not accessible' (42501); the
 * frontend hook swallowed the throw → silent empty list. Sibling base tables
 * (whatsapp_messages, conversations, whatsapp_conversations) already had
 * master-ghost policies, so only the V3 layer was blind.
 *
 * Migration: supabase/migrations/20261126000000_master_chat_conversation_list_access.sql
 * Fix: guard now also accepts is_master_user(); mark_conversation_read got the
 * same relaxation; whatsapp_conversation_summary got a master-ghost SELECT policy.
 *
 * Seed facts (supabase/seed.sql):
 *   - master@test.com (TEST_MASTER_ID) is a master_user, team_member of Org A only.
 *   - admin@test.com is org-admin + team_member of Org A, NOT a master.
 *
 * Org B is the org where master is "not a member".
 *
 * Prerequisites: `supabase start` running + `supabase db reset` (seed applied).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase as svc, TEST_ORG_B_ID, TEST_MASTER_ID } from './setup';
import { getMaster, getOrgAAdmin, clearClients } from './rls-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

const shouldSkip =
  !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

// Any non-null uuid: the guard is evaluated before the instance is dereferenced,
// so the access decision does not depend on the instance actually existing.
const DUMMY_INSTANCE = '00000000-0000-0000-0000-000000000001';

describe.skipIf(shouldSkip)('RLS: master ghost on get_whatsapp_conversation_list', () => {
  let master: SupabaseClient;
  let adminA: SupabaseClient;

  beforeAll(async () => {
    [master, adminA] = await Promise.all([getMaster(), getOrgAAdmin()]);

    // Ensure master is genuinely NOT a team_member of Org B — the whole point is
    // that the ghost path works WITHOUT membership in the target org.
    await svc
      .from('team_members')
      .delete()
      .eq('user_id', TEST_MASTER_ID)
      .eq('organization_id', TEST_ORG_B_ID);
  });

  afterAll(async () => {
    await clearClients();
  });

  it('master is NOT a team_member of Org B (precondition)', async () => {
    const { count, error } = await svc
      .from('team_members')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', TEST_MASTER_ID)
      .eq('organization_id', TEST_ORG_B_ID);
    expect(error).toBeNull();
    expect(count).toBe(0);
  });

  it('master CAN call the list RPC for Org B without a forbidden error', async () => {
    const { data, error } = await master.rpc('get_whatsapp_conversation_list', {
      p_org: TEST_ORG_B_ID,
      p_instance: DUMMY_INSTANCE,
      p_limit: 50,
    });

    // Pre-fix: error.code === '42501' ('forbidden: org not accessible').
    // Post-fix: guard passes for master → empty array (no summary rows for the
    // dummy instance), no error.
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('non-master member of Org A is DENIED the list RPC for Org B', async () => {
    const { data, error } = await adminA.rpc('get_whatsapp_conversation_list', {
      p_org: TEST_ORG_B_ID,
      p_instance: DUMMY_INSTANCE,
      p_limit: 50,
    });

    // Guard rejects: not a member of B and not a master → 42501.
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });
});
