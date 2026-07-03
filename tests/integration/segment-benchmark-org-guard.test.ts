// @vitest-environment node
/**
 * Integration test — get_segment_benchmark org-access guard (SP-0 fix #22).
 *
 * get_segment_benchmark is SECURITY DEFINER (bypasses RLS) and aggregates
 * across peer orgs. Before the fix it lacked the assert_org_access(p_org_id)
 * guard that the other 5 analytics DEFINER RPCs already carry
 * (20261114000011_guard_definer_analytics_rpcs.sql) — so ANY authenticated
 * user could call it for ANY org.
 *
 * assert_org_access semantics: service_role OR master OR active-membership pass;
 * everyone else raises 'access_denied' (P0001). This test mirrors that contract:
 *   - outsider (authed, NOT a member of the org)  → access_denied
 *   - member   (authed, team_members row for org) → guard passes, anonymized payload
 *   - service_role (backend path)                 → guard bypassed, no error
 *
 * Prerequisites: local `supabase start` + migrations, OR a remote project via
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (+ SUPABASE_ANON_KEY) envs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient, createAuthenticatedClient } from './rls-helpers';

const shouldSkip =
  !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

// Dedicated fixture org (never collides with seeds/real data).
const ORG = 'ffffffff-0000-4000-a000-00000000d001';
const PW = 'SegBenchGuard123!@#';
const OUTSIDER_EMAIL = `segbench-outsider-${Date.now()}@test.local`;
const MEMBER_EMAIL = `segbench-member-${Date.now()}@test.local`;

const admin = createServiceClient();

let outsiderUserId: string;
let memberUserId: string;
let memberTmId: string;
let outsider: SupabaseClient;
let member: SupabaseClient;

describe.skipIf(shouldSkip)('get_segment_benchmark org-access guard', () => {
  beforeAll(async () => {
    const { error: orgErr } = await admin
      .from('organizations')
      .upsert({ id: ORG, name: 'SegBench Guard Org', slug: 'segbench-guard' }, { onConflict: 'id' });
    if (orgErr) throw new Error(`org seed failed: ${orgErr.message}`);

    // Outsider — authenticated but NOT a member of ORG.
    const { data: o, error: oErr } = await admin.auth.admin.createUser({
      email: OUTSIDER_EMAIL,
      password: PW,
      email_confirm: true,
    });
    if (oErr) throw oErr;
    outsiderUserId = o.user.id;

    // Member — belongs to ORG via team_members (is_active:false dodges the
    // seat-limit billing trigger; assert_org_access only checks EXISTS, not is_active).
    const { data: m, error: mErr } = await admin.auth.admin.createUser({
      email: MEMBER_EMAIL,
      password: PW,
      email_confirm: true,
    });
    if (mErr) throw mErr;
    memberUserId = m.user.id;

    const { data: tm, error: tmErr } = await admin
      .from('team_members')
      .insert({
        user_id: memberUserId,
        organization_id: ORG,
        name: 'SegBench Member',
        role: 'member',
        is_active: false,
      })
      .select('id')
      .single();
    if (tmErr) throw new Error(`team_members seed failed: ${tmErr.message}`);
    memberTmId = tm!.id as string;

    outsider = await createAuthenticatedClient(OUTSIDER_EMAIL, PW);
    member = await createAuthenticatedClient(MEMBER_EMAIL, PW);
  }, 30_000);

  afterAll(async () => {
    if (memberTmId) await admin.from('team_members').delete().eq('id', memberTmId);
    await admin.from('leads').delete().eq('organization_id', ORG);
    await admin.from('organizations').delete().eq('id', ORG);
    if (outsiderUserId) await admin.auth.admin.deleteUser(outsiderUserId);
    if (memberUserId) await admin.auth.admin.deleteUser(memberUserId);
  }, 15_000);

  it('rejects a caller who is not a member of the org (access_denied)', async () => {
    const { data, error } = await outsider.rpc('get_segment_benchmark', { p_org_id: ORG });
    expect(error).toBeTruthy();
    expect(error!.message).toContain('access_denied');
    // No cross-tenant aggregate leaks out on the denied path.
    expect(data).toBeNull();
  });

  it('allows a member of the org — guard passes, returns anonymized aggregate shape', async () => {
    const { data, error } = await member.rpc('get_segment_benchmark', { p_org_id: ORG });
    expect(error).toBeNull();
    // Empty fixture org → "not available" shape; never a per-lead/per-peer leak.
    expect(data).toMatchObject({ available: false });
  });

  it('service_role bypasses the guard (backend/cron path)', async () => {
    const { error } = await admin.rpc('get_segment_benchmark', { p_org_id: ORG });
    expect(error).toBeNull();
  });
});
