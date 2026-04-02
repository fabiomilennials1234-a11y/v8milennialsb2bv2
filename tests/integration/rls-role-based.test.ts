// @vitest-environment node
/**
 * RLS Integration Tests: Role-Based Access
 *
 * Verifies that admin-only config tables reject member writes,
 * and that master users bypass all RLS for cross-org reads.
 *
 * Prerequisites:
 *   1. `supabase start` must be running
 *   2. `supabase db reset` to apply seed.sql
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getOrgAAdmin,
  getOrgAMember1,
  getMaster,
  getOrgBAdmin,
  clearClients,
  createServiceClient,
  expectInsertDenied,
  expectDeleteDenied,
} from './rls-helpers';
import { TEST_ORG_ID, TEST_ORG_B_ID } from './setup';
import type { SupabaseClient } from '@supabase/supabase-js';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

// Deterministic test UUIDs -- easy to clean up
const TEST_TAG_ID = '99990000-0000-0000-0000-000000000001';
const TEST_TAG_MEMBER_ID = '99990000-0000-0000-0000-000000000002';
const TEST_ORP_ID = '99990000-0000-0000-0000-000000000011';
const TEST_ORP_MEMBER_ID = '99990000-0000-0000-0000-000000000012';

describe.skipIf(shouldSkip)('RLS: Role-based access', () => {
  let admin: SupabaseClient;
  let member: SupabaseClient;
  let master: SupabaseClient;
  let orgBAdmin: SupabaseClient;
  let svc: SupabaseClient;

  beforeAll(async () => {
    [admin, member, master, orgBAdmin] = await Promise.all([
      getOrgAAdmin(),
      getOrgAMember1(),
      getMaster(),
      getOrgBAdmin(),
    ]);
    svc = createServiceClient();
  });

  afterAll(async () => {
    // Deterministic cleanup via service client -- catches any leaked rows
    const cleanupIds = [TEST_TAG_ID, TEST_TAG_MEMBER_ID];
    const cleanupOrpIds = [TEST_ORP_ID, TEST_ORP_MEMBER_ID];

    await Promise.all([
      svc.from('tags').delete().in('id', cleanupIds),
      svc.from('organization_role_permissions').delete().in('id', cleanupOrpIds),
    ]);

    await clearClients();
  });

  // ================================================================
  // TAGS -- Admin-only write table
  // ================================================================
  describe('tags', () => {
    it('admin can SELECT tags', async () => {
      const { error } = await admin
        .from('tags')
        .select('id')
        .eq('organization_id', TEST_ORG_ID)
        .limit(1);

      expect(error).toBeNull();
    });

    it('member can SELECT tags', async () => {
      const { error } = await member
        .from('tags')
        .select('id')
        .eq('organization_id', TEST_ORG_ID)
        .limit(1);

      expect(error).toBeNull();
    });

    it('admin can INSERT a tag', async () => {
      const { error } = await admin.from('tags').insert({
        id: TEST_TAG_ID,
        name: `__rls_test_admin_${Date.now()}`,
        organization_id: TEST_ORG_ID,
        color: '#FF0000',
      });

      expect(error).toBeNull();
    });

    it('member CANNOT INSERT a tag (admin-only)', async () => {
      await expectInsertDenied(member, 'tags', {
        id: TEST_TAG_MEMBER_ID,
        name: `__rls_test_member_${Date.now()}`,
        organization_id: TEST_ORG_ID,
        color: '#00FF00',
      });
    });

    it('admin can DELETE a tag they inserted', async () => {
      // Ensure the row exists (idempotent -- may already exist from prior test)
      await svc.from('tags').upsert({
        id: TEST_TAG_ID,
        name: `__rls_test_admin_del_${Date.now()}`,
        organization_id: TEST_ORG_ID,
        color: '#FF0000',
      });

      const { error, count } = await admin
        .from('tags')
        .delete({ count: 'exact' })
        .eq('id', TEST_TAG_ID);

      expect(error).toBeNull();
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it('member CANNOT DELETE a tag (admin-only)', async () => {
      // Ensure row exists via service client
      await svc.from('tags').upsert({
        id: TEST_TAG_ID,
        name: `__rls_test_member_del_${Date.now()}`,
        organization_id: TEST_ORG_ID,
        color: '#FF0000',
      });

      await expectDeleteDenied(member, 'tags', TEST_TAG_ID);
    });
  });

  // ================================================================
  // ORGANIZATION_ROLE_PERMISSIONS -- Admin-only write table
  // ================================================================
  describe('organization_role_permissions', () => {
    it('admin can SELECT organization_role_permissions', async () => {
      const { error } = await admin
        .from('organization_role_permissions')
        .select('id')
        .eq('organization_id', TEST_ORG_ID)
        .limit(1);

      expect(error).toBeNull();
    });

    it('member can SELECT organization_role_permissions', async () => {
      const { error } = await member
        .from('organization_role_permissions')
        .select('id')
        .eq('organization_id', TEST_ORG_ID)
        .limit(1);

      expect(error).toBeNull();
    });

    it('admin can INSERT an organization_role_permission', async () => {
      // Clean up any existing row with this test ID
      await svc
        .from('organization_role_permissions')
        .delete()
        .eq('id', TEST_ORP_ID);

      const { error } = await admin.from('organization_role_permissions').insert({
        id: TEST_ORP_ID,
        organization_id: TEST_ORG_ID,
        role: 'closer',
        permission_key: 'see_unassigned_cards',
        enabled: false,
      });

      expect(error).toBeNull();
    });

    it('member CANNOT INSERT an organization_role_permission', async () => {
      await expectInsertDenied(member, 'organization_role_permissions', {
        id: TEST_ORP_MEMBER_ID,
        organization_id: TEST_ORG_ID,
        role: 'closer',
        permission_key: 'see_subordinates_cards',
        enabled: false,
      });
    });

    it('admin can DELETE an organization_role_permission they inserted', async () => {
      // Ensure the row exists
      await svc.from('organization_role_permissions').upsert({
        id: TEST_ORP_ID,
        organization_id: TEST_ORG_ID,
        role: 'closer',
        permission_key: 'see_unassigned_cards',
        enabled: false,
      });

      const { error, count } = await admin
        .from('organization_role_permissions')
        .delete({ count: 'exact' })
        .eq('id', TEST_ORP_ID);

      expect(error).toBeNull();
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it('member CANNOT DELETE an organization_role_permission', async () => {
      // Re-create via service client
      await svc.from('organization_role_permissions').upsert({
        id: TEST_ORP_ID,
        organization_id: TEST_ORG_ID,
        role: 'closer',
        permission_key: 'see_unassigned_cards',
        enabled: false,
      });

      await expectDeleteDenied(member, 'organization_role_permissions', TEST_ORP_ID);
    });
  });

  // ================================================================
  // MASTER BYPASS -- Cross-org read access
  // ================================================================
  describe('master bypass', () => {
    // ----- leads -----
    describe('leads', () => {
      it('master can read Org A leads', async () => {
        const { data, error } = await master
          .from('leads')
          .select('id')
          .eq('organization_id', TEST_ORG_ID);

        expect(error).toBeNull();
        expect(data).not.toBeNull();
        expect(data!.length).toBeGreaterThan(0);
      });

      it('master can read Org B leads', async () => {
        const { data, error } = await master
          .from('leads')
          .select('id')
          .eq('organization_id', TEST_ORG_B_ID);

        expect(error).toBeNull();
        expect(data).not.toBeNull();
        expect(data!.length).toBeGreaterThan(0);
      });

      it('master total leads = Org A + Org B', async () => {
        const [orgA, orgB, total] = await Promise.all([
          master
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', TEST_ORG_ID),
          master
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', TEST_ORG_B_ID),
          master
            .from('leads')
            .select('id', { count: 'exact', head: true }),
        ]);

        expect(orgA.error).toBeNull();
        expect(orgB.error).toBeNull();
        expect(total.error).toBeNull();

        const sumByOrg = (orgA.count ?? 0) + (orgB.count ?? 0);
        expect(total.count).toBe(sumByOrg);
      });
    });

    // ----- tags -----
    describe('tags', () => {
      it('master can read Org A tags', async () => {
        const { data, error } = await master
          .from('tags')
          .select('id')
          .eq('organization_id', TEST_ORG_ID);

        expect(error).toBeNull();
        expect(data).not.toBeNull();
        expect(data!.length).toBeGreaterThan(0);
      });

      it('master can read Org B tags', async () => {
        const { data, error } = await master
          .from('tags')
          .select('id')
          .eq('organization_id', TEST_ORG_B_ID);

        expect(error).toBeNull();
        expect(data).not.toBeNull();
        expect(data!.length).toBeGreaterThan(0);
      });

      it('master total tags = Org A + Org B', async () => {
        const [orgA, orgB, total] = await Promise.all([
          master
            .from('tags')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', TEST_ORG_ID),
          master
            .from('tags')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', TEST_ORG_B_ID),
          master
            .from('tags')
            .select('id', { count: 'exact', head: true }),
        ]);

        expect(orgA.error).toBeNull();
        expect(orgB.error).toBeNull();
        expect(total.error).toBeNull();

        const sumByOrg = (orgA.count ?? 0) + (orgB.count ?? 0);
        expect(total.count).toBe(sumByOrg);
      });
    });

    // ----- team_members -----
    describe('team_members', () => {
      it('master can read Org A team_members', async () => {
        const { data, error } = await master
          .from('team_members')
          .select('id')
          .eq('organization_id', TEST_ORG_ID);

        expect(error).toBeNull();
        expect(data).not.toBeNull();
        expect(data!.length).toBeGreaterThan(0);
      });

      it('master can read Org B team_members', async () => {
        const { data, error } = await master
          .from('team_members')
          .select('id')
          .eq('organization_id', TEST_ORG_B_ID);

        expect(error).toBeNull();
        expect(data).not.toBeNull();
        expect(data!.length).toBeGreaterThan(0);
      });

      it('master total team_members = Org A + Org B', async () => {
        const [orgA, orgB, total] = await Promise.all([
          master
            .from('team_members')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', TEST_ORG_ID),
          master
            .from('team_members')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', TEST_ORG_B_ID),
          master
            .from('team_members')
            .select('id', { count: 'exact', head: true }),
        ]);

        expect(orgA.error).toBeNull();
        expect(orgB.error).toBeNull();
        expect(total.error).toBeNull();

        const sumByOrg = (orgA.count ?? 0) + (orgB.count ?? 0);
        expect(total.count).toBe(sumByOrg);
      });
    });
  });
});
