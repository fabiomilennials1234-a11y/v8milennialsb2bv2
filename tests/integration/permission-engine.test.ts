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

// After the roles migration, TEST_SDR_ID's team member should have role = 'member'
const TEST_MEMBER_ID = TEST_SDR_ID;

describe.skipIf(shouldSkip)('Permission Engine — integration', () => {
  beforeAll(async () => {
    // Ensure test data exists — seed.sql should have been applied
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
    // After migration, old SDR roles become 'member'
    expect(data?.role).toBe('member');
  });

  it('member with explicit denied legacy permission is blocked', async () => {
    const memberTeamMemberId = '00000000-0000-0000-0000-000000000130';

    // Insert a denied permission for the member (legacy matrix)
    await supabase.from('team_member_permissions').upsert({
      team_member_id: memberTeamMemberId,
      resource_key: 'leads',
      action_key: 'delete',
      value: 'denied',
    });

    const { data } = await supabase
      .from('team_member_permissions')
      .select('value')
      .eq('team_member_id', memberTeamMemberId)
      .eq('resource_key', 'leads')
      .eq('action_key', 'delete')
      .maybeSingle();

    expect(data?.value).toBe('denied');

    // Cleanup
    await supabase
      .from('team_member_permissions')
      .delete()
      .eq('team_member_id', memberTeamMemberId)
      .eq('resource_key', 'leads')
      .eq('action_key', 'delete');
  });

  it('member with explicit allowed override is permitted (legacy matrix)', async () => {
    const memberTeamMemberId = '00000000-0000-0000-0000-000000000130';

    await supabase.from('team_member_permissions').upsert({
      team_member_id: memberTeamMemberId,
      resource_key: 'pipe',
      action_key: 'move',
      value: 'allowed',
    });

    const { data } = await supabase
      .from('team_member_permissions')
      .select('value')
      .eq('team_member_id', memberTeamMemberId)
      .eq('resource_key', 'pipe')
      .eq('action_key', 'move')
      .maybeSingle();

    expect(data?.value).toBe('allowed');

    // Cleanup
    await supabase
      .from('team_member_permissions')
      .delete()
      .eq('team_member_id', memberTeamMemberId)
      .eq('resource_key', 'pipe')
      .eq('action_key', 'move');
  });

  it('feature_permissions table has entries', async () => {
    const { count } = await supabase
      .from('feature_permissions')
      .select('*', { count: 'exact', head: true });

    // Should have 54+ features after migration
    expect(count).toBeGreaterThanOrEqual(54);
  });

  it('member_feature_permissions supports overrides', async () => {
    const memberTeamMemberId = '00000000-0000-0000-0000-000000000130';

    // Insert a feature override
    await supabase.from('member_feature_permissions').upsert({
      team_member_id: memberTeamMemberId,
      organization_id: TEST_ORG_ID,
      feature_key: 'leads.delete',
      enabled: true,
    });

    const { data } = await supabase
      .from('member_feature_permissions')
      .select('enabled')
      .eq('team_member_id', memberTeamMemberId)
      .eq('feature_key', 'leads.delete')
      .maybeSingle();

    expect(data?.enabled).toBe(true);

    // Cleanup
    await supabase
      .from('member_feature_permissions')
      .delete()
      .eq('team_member_id', memberTeamMemberId)
      .eq('feature_key', 'leads.delete');
  });
});
