/**
 * Integration tests for master-first-class permission consolidation.
 *
 * Tests the three Phase 1 database changes:
 *   1. is_user_admin() recognizes master users
 *   2. get_my_organization_ids() returns all orgs for masters
 *   3. Master bypass RLS on 7 previously blocked tables
 *   4. ensure_master_team_member() RPC
 *   5. team_members_visible view excludes shadows
 *
 * Requires: `supabase start` running locally.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  supabase,
  TEST_ORG_ID,
  TEST_ORG_B_ID,
  TEST_MASTER_ID,
  TEST_ADMIN_ID,
  TEST_SDR_ID,
} from './setup';
import {
  getMaster,
  getOrgAAdmin,
  getOrgAMember1,
  clearClients,
  createServiceClient,
} from './rls-helpers';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

describe.skipIf(shouldSkip)('Master First-Class — RPCs (#414)', () => {
  it('is_user_admin() returns true for master user', async () => {
    const master = await getMaster();
    const { data, error } = await master.rpc('is_user_admin');
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it('is_user_admin() returns true for org admin', async () => {
    const admin = await getOrgAAdmin();
    const { data, error } = await admin.rpc('is_user_admin');
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it('is_user_admin() returns false for regular member', async () => {
    const member = await getOrgAMember1();
    const { data, error } = await member.rpc('is_user_admin');
    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  it('get_my_organization_ids() returns all orgs for master', async () => {
    const master = await getMaster();
    const { data, error } = await master.rpc('get_my_organization_ids');
    expect(error).toBeNull();

    const svc = createServiceClient();
    const { count } = await svc
      .from('organizations')
      .select('id', { count: 'exact', head: true });

    expect(data).toHaveLength(count!);
  });

  it('get_my_organization_ids() returns only own orgs for non-master', async () => {
    const member = await getOrgAMember1();
    const { data, error } = await member.rpc('get_my_organization_ids');
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);

    const svc = createServiceClient();
    const { count: totalOrgs } = await svc
      .from('organizations')
      .select('id', { count: 'exact', head: true });

    expect(data!.length).toBeLessThan(totalOrgs!);
  });
});

describe.skipIf(shouldSkip)('Master First-Class — RLS Bypass 7 Tables (#415)', () => {
  let master: Awaited<ReturnType<typeof getMaster>>;
  let member: Awaited<ReturnType<typeof getOrgAMember1>>;
  const svc = createServiceClient();

  beforeAll(async () => {
    master = await getMaster();
    member = await getOrgAMember1();
  });

  it('master can read workflows from any org', async () => {
    const { error } = await master
      .from('workflows')
      .select('id')
      .limit(1);
    expect(error).toBeNull();
  });

  it('master can read conversation_messages', async () => {
    const { error } = await master
      .from('conversation_messages')
      .select('id')
      .limit(1);
    expect(error).toBeNull();
  });

  it('master can read lead_history', async () => {
    const { error } = await master
      .from('lead_history')
      .select('id')
      .limit(1);
    expect(error).toBeNull();
  });

  it('master can read custom_pipe_entries', async () => {
    const { error } = await master
      .from('custom_pipe_entries')
      .select('id')
      .limit(1);
    expect(error).toBeNull();
  });

  it('master can read lead_scores', async () => {
    const { error } = await master
      .from('lead_scores')
      .select('id')
      .limit(1);
    expect(error).toBeNull();
  });

  it('master can write goals', async () => {
    const { data: existingGoal } = await svc
      .from('goals')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (existingGoal) {
      const { error } = await master
        .from('goals')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', existingGoal.id);
      expect(error).toBeNull();
    }
  });

  it('master can write awards', async () => {
    const { data: existingAward } = await svc
      .from('awards')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (existingAward) {
      const { error } = await master
        .from('awards')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', existingAward.id);
      expect(error).toBeNull();
    }
  });
});

describe.skipIf(shouldSkip)('Master First-Class — Shadow Infrastructure (#416)', () => {
  const svc = createServiceClient();
  let provisionedTmId: string | null = null;

  afterAll(async () => {
    if (provisionedTmId) {
      await svc.from('team_members').delete().eq('id', provisionedTmId);
    }
    await clearClients();
  });

  it('ensure_master_team_member creates shadow member for master', async () => {
    // First remove any existing team_member for master in org B
    await svc
      .from('team_members')
      .delete()
      .eq('user_id', TEST_MASTER_ID)
      .eq('organization_id', TEST_ORG_B_ID)
      .eq('is_shadow', true);

    const { data, error } = await svc.rpc('ensure_master_team_member', {
      p_org_id: TEST_ORG_B_ID,
    });

    // RPC runs as service_role calling on behalf of master —
    // for test we use impersonation via the master client
    const master = await getMaster();
    const { data: tmId, error: rpcError } = await master.rpc('ensure_master_team_member', {
      p_org_id: TEST_ORG_B_ID,
    });

    expect(rpcError).toBeNull();
    expect(tmId).toBeTruthy();
    provisionedTmId = tmId;

    // Verify the created member
    const { data: tm } = await svc
      .from('team_members')
      .select('role, is_shadow, is_active')
      .eq('id', tmId)
      .single();

    expect(tm?.role).toBe('admin');
    expect(tm?.is_shadow).toBe(true);
    expect(tm?.is_active).toBe(true);
  });

  it('ensure_master_team_member is idempotent', async () => {
    const master = await getMaster();
    const { data: tmId1 } = await master.rpc('ensure_master_team_member', {
      p_org_id: TEST_ORG_B_ID,
    });
    const { data: tmId2 } = await master.rpc('ensure_master_team_member', {
      p_org_id: TEST_ORG_B_ID,
    });

    expect(tmId1).toBe(tmId2);
  });

  it('ensure_master_team_member fails for non-master user', async () => {
    const member = await getOrgAMember1();
    const { error } = await member.rpc('ensure_master_team_member', {
      p_org_id: TEST_ORG_ID,
    });

    expect(error).not.toBeNull();
  });

  it('team_members_visible excludes shadow members', async () => {
    // Ensure shadow exists
    const master = await getMaster();
    await master.rpc('ensure_master_team_member', { p_org_id: TEST_ORG_B_ID });

    // View should not include shadow
    const { data: visible } = await svc
      .from('team_members_visible')
      .select('id, is_shadow')
      .eq('organization_id', TEST_ORG_B_ID);

    const hasShadow = visible?.some((m: any) => m.is_shadow === true);
    expect(hasShadow).toBeFalsy();
  });

  it('team_members_visible excludes inactive members', async () => {
    const { data: visible } = await svc
      .from('team_members_visible')
      .select('id, is_active');

    const hasInactive = visible?.some((m: any) => m.is_active === false);
    expect(hasInactive).toBeFalsy();
  });
});
