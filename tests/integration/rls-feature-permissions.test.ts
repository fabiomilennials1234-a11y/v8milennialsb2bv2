// @vitest-environment node
/**
 * RLS integration tests: feature permissions and permission RPCs.
 *
 * Validates that has_feature_permission() works correctly within RLS policies,
 * and tests permission-related RPCs (is_user_admin, user_has_org_permission,
 * is_master_user) directly via authenticated clients.
 *
 * Seed data assumptions (see supabase/seed.sql):
 *   - Org A has 4 leads: Alpha (sdr=TM140), Beta (closer=TM150), Gamma (unassigned), Delta (sdr=TM140,closer=TM150)
 *   - Member1 (TM 140, user_id 040) tem overrides EXPLÍCITOS = false para
 *     leads.view_all, leads.view_unassigned e leads.view_subordinates. Antes de
 *     2026-08-17 ele não tinha override nenhum e o teste se apoiava no
 *     default_value da seed (false) — que em produção é true.
 *   - Member2 (TM 150, user_id 050) has member_feature_permissions override: leads.view_all = true
 *   - feature_permissions: catálogo alinhado com produção pela migration
 *     20270818120000 (81 chaves). leads.view_all default=true; a única chave
 *     admin_only é voip.session.manage.
 *
 * Prerequisites: `supabase start` running, `supabase db reset` applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  getOrgAAdmin,
  getOrgAMember1,
  getOrgAMember2,
  getMaster,
  clearClients,
  createServiceClient,
} from './rls-helpers';
import {
  TEST_ORG_ID,
  TEST_MASTER_ID,
  TEST_ADMIN_ID,
} from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

describe.skipIf(shouldSkip)('RLS: Feature permissions and RPCs', () => {
  let adminClient: SupabaseClient;
  let member1Client: SupabaseClient;
  let member2Client: SupabaseClient;
  let masterClient: SupabaseClient;
  let serviceClient: SupabaseClient;

  beforeAll(async () => {
    [adminClient, member1Client, member2Client, masterClient] = await Promise.all([
      getOrgAAdmin(),
      getOrgAMember1(),
      getOrgAMember2(),
      getMaster(),
    ]);
    serviceClient = createServiceClient();

    // Verify seed data exists
    const { data: orgData } = await serviceClient
      .from('organizations')
      .select('id')
      .eq('id', TEST_ORG_ID)
      .maybeSingle();

    if (!orgData) {
      console.warn('Test org not found. Run `supabase db reset` to apply seed.sql.');
    }
  });

  afterAll(async () => {
    await clearClients();
  });

  // ---------------------------------------------------------------
  // Feature permission effects on lead visibility via RLS
  // ---------------------------------------------------------------

  describe('Feature permission effects on lead visibility', () => {
    it('Member1 without leads.view_all sees only assigned leads (2)', async () => {
      // Member1 (TM 140) is sdr on Alpha and Delta -- override explícito leads.view_all=false
      const { data, error } = await member1Client
        .from('leads')
        .select('id')
        .eq('organization_id', TEST_ORG_ID);

      expect(error).toBeNull();
      expect(data).toHaveLength(2);

      const ids = data!.map((l) => l.id).sort();
      expect(ids).toContain('00000000-0000-0000-0000-000000001001'); // Alpha (sdr=TM140)
      expect(ids).toContain('00000000-0000-0000-0000-000000001004'); // Delta (sdr=TM140)
    });

    it('Member2 WITH leads.view_all override sees all org leads (4)', async () => {
      // Member2 (TM 150) has member_feature_permissions: leads.view_all = true
      const { data, error } = await member2Client
        .from('leads')
        .select('id')
        .eq('organization_id', TEST_ORG_ID);

      expect(error).toBeNull();
      expect(data).toHaveLength(4);
    });

    it('Admin sees all leads regardless of feature permissions', async () => {
      const { data, error } = await adminClient
        .from('leads')
        .select('id')
        .eq('organization_id', TEST_ORG_ID);

      expect(error).toBeNull();
      expect(data).toHaveLength(4);
    });

    it('Master sees all leads regardless of feature permissions', async () => {
      const { data, error } = await masterClient
        .from('leads')
        .select('id')
        .eq('organization_id', TEST_ORG_ID);

      expect(error).toBeNull();
      expect(data).toHaveLength(4);
    });

    it('Member1 does NOT see unassigned leads (Gamma) when see_unassigned_cards=false', async () => {
      const { data, error } = await member1Client
        .from('leads')
        .select('id')
        .eq('id', '00000000-0000-0000-0000-000000001003'); // Gamma -- unassigned

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it('Member1 does NOT see leads assigned to others (Beta) when see_all_leads=false', async () => {
      const { data, error } = await member1Client
        .from('leads')
        .select('id')
        .eq('id', '00000000-0000-0000-0000-000000001002'); // Beta -- closer=TM150

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it('Member2 sees unassigned leads (Gamma) with leads.view_all=true', async () => {
      const { data, error } = await member2Client
        .from('leads')
        .select('id')
        .eq('id', '00000000-0000-0000-0000-000000001003'); // Gamma -- unassigned

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it('Member2 sees leads assigned to others (Alpha) with leads.view_all=true', async () => {
      const { data, error } = await member2Client
        .from('leads')
        .select('id')
        .eq('id', '00000000-0000-0000-0000-000000001001'); // Alpha -- sdr=TM140

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------
  // Direct RPC tests: is_user_admin()
  // ---------------------------------------------------------------

  describe('RPC: is_user_admin()', () => {
    it('returns true when called as admin', async () => {
      const { data, error } = await adminClient.rpc('is_user_admin');

      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it('returns false when called as member', async () => {
      const { data, error } = await member1Client.rpc('is_user_admin');

      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it('returns true when called as master (master has admin role in team_members)', async () => {
      const { data, error } = await masterClient.rpc('is_user_admin');

      expect(error).toBeNull();
      expect(data).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // Direct RPC tests: user_has_org_permission()
  // ---------------------------------------------------------------

  describe('RPC: user_has_org_permission()', () => {
    it('returns false for member on can_delete_leads (org permission disabled)', async () => {
      const { data, error } = await member1Client.rpc('user_has_org_permission', {
        p_permission_key: 'can_delete_leads',
      });

      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it('returns true for admin on can_delete_leads (admin always true)', async () => {
      const { data, error } = await adminClient.rpc('user_has_org_permission', {
        p_permission_key: 'can_delete_leads',
      });

      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it('returns false for member on see_all_leads (org permission disabled)', async () => {
      const { data, error } = await member1Client.rpc('user_has_org_permission', {
        p_permission_key: 'see_all_leads',
      });

      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it('returns true for admin on see_all_leads (admin always true)', async () => {
      const { data, error } = await adminClient.rpc('user_has_org_permission', {
        p_permission_key: 'see_all_leads',
      });

      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it('returns false for member on see_unassigned_cards (org permission disabled)', async () => {
      const { data, error } = await member1Client.rpc('user_has_org_permission', {
        p_permission_key: 'see_unassigned_cards',
      });

      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it('returns true for member on see_general_info (org permission enabled)', async () => {
      const { data, error } = await member1Client.rpc('user_has_org_permission', {
        p_permission_key: 'see_general_info',
      });

      expect(error).toBeNull();
      expect(data).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // Direct RPC tests: has_feature_permission()
  // If not exposed as RPC, these gracefully skip. The behavior
  // is still covered by the lead visibility tests above.
  // ---------------------------------------------------------------

  describe('RPC: has_feature_permission()', () => {
    it('returns false for member1 on leads.view_all (override explícito=false)', async () => {
      const { data, error } = await member1Client.rpc('has_feature_permission', {
        p_feature_key: 'leads.view_all',
      });

      // If the function is not exposed as RPC, skip gracefully
      if (error && error.message.includes('Could not find the function')) {
        console.warn('has_feature_permission not exposed as RPC -- tested indirectly via lead visibility');
        return;
      }

      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it('returns true for member2 on leads.view_all (has override=true)', async () => {
      const { data, error } = await member2Client.rpc('has_feature_permission', {
        p_feature_key: 'leads.view_all',
      });

      if (error && error.message.includes('Could not find the function')) {
        return; // Covered by lead visibility tests
      }

      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it('returns true for admin on leads.view_all (admin always true)', async () => {
      const { data, error } = await adminClient.rpc('has_feature_permission', {
        p_feature_key: 'leads.view_all',
      });

      if (error && error.message.includes('Could not find the function')) {
        return;
      }

      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it('returns true for member on leads.create (default=true, no override)', async () => {
      const { data, error } = await member1Client.rpc('has_feature_permission', {
        p_feature_key: 'leads.create',
      });

      if (error && error.message.includes('Could not find the function')) {
        return;
      }

      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it('returns false for member on voip.session.manage (admin_only=true)', async () => {
      // Era `workflows.edit`. Em produção essa chave não é admin_only, então a
      // asserção "member recebe false" descrevia a seed, não o produto.
      const { data, error } = await member1Client.rpc('has_feature_permission', {
        p_feature_key: 'voip.session.manage',
      });

      if (error && error.message.includes('Could not find the function')) {
        return;
      }

      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it('returns true for admin on workflows.edit (admin always true)', async () => {
      const { data, error } = await adminClient.rpc('has_feature_permission', {
        p_feature_key: 'workflows.edit',
      });

      if (error && error.message.includes('Could not find the function')) {
        return;
      }

      expect(error).toBeNull();
      expect(data).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // Master user RPCs
  // ---------------------------------------------------------------

  describe('RPC: is_master_user()', () => {
    it('returns true when called as master user', async () => {
      // is_master_user() defaults _user_id to auth.uid(), so calling
      // from masterClient should return true
      const { data, error } = await masterClient.rpc('is_master_user');

      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it('returns false when called as regular admin', async () => {
      const { data, error } = await adminClient.rpc('is_master_user');

      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it('returns false when called as regular member', async () => {
      const { data, error } = await member1Client.rpc('is_master_user');

      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it('returns true for master user_id via service client', async () => {
      // is_master_user accepts optional _user_id parameter
      const { data, error } = await serviceClient.rpc('is_master_user', {
        _user_id: TEST_MASTER_ID,
      });

      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it('returns false for admin user_id via service client', async () => {
      const { data, error } = await serviceClient.rpc('is_master_user', {
        _user_id: TEST_ADMIN_ID,
      });

      expect(error).toBeNull();
      expect(data).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // Feature permission catalog (data integrity)
  // ---------------------------------------------------------------

  describe('Feature permission catalog integrity', () => {
    it('feature_permissions table contains leads.view_all with correct config', async () => {
      const { data, error } = await member1Client
        .from('feature_permissions')
        .select('key, is_admin_only, default_value')
        .eq('key', 'leads.view_all')
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.is_admin_only).toBe(false);
      // default_value=true é o valor de PRODUÇÃO. Antes de 2026-08-17 a seed
      // dizia false e este teste concordava com a seed, não com o produto.
      expect(data!.default_value).toBe(true);
    });

    it('voip.session.manage is admin_only in feature_permissions', async () => {
      // Era `workflows.edit`, que em produção NÃO é admin_only (medido:
      // is_admin_only=false). `voip.session.manage` é a única chave
      // genuinamente admin-only do catálogo de produção.
      const { data, error } = await member1Client
        .from('feature_permissions')
        .select('key, is_admin_only, default_value')
        .eq('key', 'voip.session.manage')
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.is_admin_only).toBe(true);
    });

    it('member2 has leads.view_all override in member_feature_permissions', async () => {
      // member2 should be able to read their own feature permissions
      const { data, error } = await member2Client
        .from('member_feature_permissions')
        .select('feature_key, enabled')
        .eq('team_member_id', '00000000-0000-0000-0000-000000000150')
        .eq('feature_key', 'leads.view_all')
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.enabled).toBe(true);
    });

    it('member1 lê os próprios overrides e todos são restritivos', async () => {
      // Já falhava em origin/main: a seed dava a TM140 o override
      // leads.delete=false, e a policy member_read_own_features deixa o membro
      // ler os próprios. A asserção "0 overrides" nunca foi verdade.
      const { data, error } = await member1Client
        .from('member_feature_permissions')
        .select('feature_key, enabled')
        .eq('team_member_id', '00000000-0000-0000-0000-000000000140');

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThan(0); // controle positivo
      expect(data!.every((r) => r.enabled === false)).toBe(true);
      expect(data!.map((r) => r.feature_key).sort()).toEqual([
        'leads.delete',
        'leads.view_all',
        'leads.view_subordinates',
        'leads.view_unassigned',
      ]);
    });

    it('member1 não lê os overrides de outro membro', async () => {
      const { data, error } = await member1Client
        .from('member_feature_permissions')
        .select('feature_key')
        .eq('team_member_id', '00000000-0000-0000-0000-000000000150');

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });
});
