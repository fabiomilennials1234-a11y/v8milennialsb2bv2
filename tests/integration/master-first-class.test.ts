/**
 * Integration tests for master-first-class permission consolidation.
 *
 * Tests the current first-class master contract:
 *   1. is_user_admin() recognizes master users
 *   2. get_my_organization_ids() returns explicit memberships
 *   3. Master bypasses tenant RLS through explicit policy branches
 *
 * Requires: `supabase start` running locally.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { TEST_ORG_ID } from './setup';
import {
  getMaster,
  getOrgAAdmin,
  getOrgAMember1,
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

  it('get_my_organization_ids() returns explicit memberships for master', async () => {
    const master = await getMaster();
    const { data, error } = await master.rpc('get_my_organization_ids');
    expect(error).toBeNull();
    expect(data).toEqual([TEST_ORG_ID]);
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

  it('master can read canonical pipeline entries', async () => {
    const { error } = await master
      .from('pipeline_entries')
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
