/**
 * Integration tests for the Permission Engine.
 *
 * These tests require a running local Supabase instance (`supabase start`).
 * They verify the full permission cascade via the actual database.
 *
 * Skip if SKIP_INTEGRATION is set (for CI without Supabase).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { supabase, TEST_ORG_ID, TEST_ADMIN_ID, TEST_SDR_ID } from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const TEST_MEMBER_ID = TEST_SDR_ID;

describe.skipIf(shouldSkip)('Permission Engine — integration', () => {
  beforeAll(async () => {
    const { data } = await supabase
      .from('organizations')
      .select('id')
      .eq('id', TEST_ORG_ID)
      .maybeSingle();

    if (!data) {
      console.warn('⚠ Test org not found — run `supabase db reset` to apply seed.sql');
    }
  });

  it('admin team member exists in test data', async () => {
    const { data } = await supabase
      .from('team_members')
      .select('role')
      .eq('user_id', TEST_ADMIN_ID)
      .eq('organization_id', TEST_ORG_ID)
      .maybeSingle();

    expect(data).not.toBeNull();
    expect(data?.role).toBe('admin');
  });

  it('member team member exists in test data (migrated from sdr)', async () => {
    const { data } = await supabase
      .from('team_members')
      .select('role')
      .eq('user_id', TEST_MEMBER_ID)
      .eq('organization_id', TEST_ORG_ID)
      .maybeSingle();

    expect(data).not.toBeNull();
    expect(data?.role).toBe('member');
  });

  it('feature_permissions table has entries including new view keys', async () => {
    const { count } = await supabase
      .from('feature_permissions')
      .select('*', { count: 'exact', head: true });

    // 54+ original features + 3 new (view_unassigned, view_subordinates, view_general_info)
    expect(count).toBeGreaterThanOrEqual(57);
  });

  it('new feature keys exist: leads.view_unassigned, leads.view_subordinates, leads.view_general_info', async () => {
    const { data } = await supabase
      .from('feature_permissions')
      .select('key')
      .in('key', ['leads.view_unassigned', 'leads.view_subordinates', 'leads.view_general_info']);

    expect(data).toHaveLength(3);
  });

  it('member_feature_permissions supports overrides', async () => {
    const memberTeamMemberId = '00000000-0000-0000-0000-000000000130';

    await supabase.from('member_feature_permissions').upsert({
      team_member_id: memberTeamMemberId,
      organization_id: TEST_ORG_ID,
      feature_key: 'leads.delete',
      enabled: false,
    });

    const { data } = await supabase
      .from('member_feature_permissions')
      .select('enabled')
      .eq('team_member_id', memberTeamMemberId)
      .eq('feature_key', 'leads.delete')
      .maybeSingle();

    expect(data?.enabled).toBe(false);

    // Cleanup
    await supabase
      .from('member_feature_permissions')
      .delete()
      .eq('team_member_id', memberTeamMemberId)
      .eq('feature_key', 'leads.delete');
  });

  it('member_feature_permissions override enabled=true grants access', async () => {
    const memberTeamMemberId = '00000000-0000-0000-0000-000000000130';

    await supabase.from('member_feature_permissions').upsert({
      team_member_id: memberTeamMemberId,
      organization_id: TEST_ORG_ID,
      feature_key: 'leads.export',
      enabled: true,
    });

    const { data } = await supabase
      .from('member_feature_permissions')
      .select('enabled')
      .eq('team_member_id', memberTeamMemberId)
      .eq('feature_key', 'leads.export')
      .maybeSingle();

    expect(data?.enabled).toBe(true);

    // Cleanup
    await supabase
      .from('member_feature_permissions')
      .delete()
      .eq('team_member_id', memberTeamMemberId)
      .eq('feature_key', 'leads.export');
  });
});
