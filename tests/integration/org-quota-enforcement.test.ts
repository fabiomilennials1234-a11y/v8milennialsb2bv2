/**
 * Integration tests: org-quota-enforcement
 *
 * Tests the full quota lifecycle against a live Supabase instance:
 *   - org_quotas table structure & generated columns
 *   - org_resolve_quota / org_resolve_all_quotas RPCs
 *   - Trigger enforcement (whatsapp_instances, copilot_agents)
 *   - admin_set_purchased_addons (service_role)
 *   - sync_org_quotas_from_plan
 *   - org_get_features_and_limits integration
 *
 * Runs against DEV when SUPABASE_URL is set, or local Supabase.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const TEST_ORG_ID = '00000000-0000-0000-0000-000000000001';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

// Resolved in beforeAll — a valid auth.users ID needed for FK constraints
let VALID_USER_ID = '';

// ─── Helpers ──────────────────────────────────────────────────

async function setQuotaForTest(
  resourceKey: string,
  planBase: number,
  addons = 0,
  adjustment = 0
) {
  // Direct table upsert via service_role (bypasses RLS)
  const { error } = await supabase
    .from('org_quotas')
    .upsert(
      {
        organization_id: TEST_ORG_ID,
        resource_key: resourceKey,
        plan_base: planBase,
        purchased_addons: addons,
        admin_adjustment: adjustment,
      },
      { onConflict: 'organization_id,resource_key' }
    );
  if (error) throw new Error(`setQuotaForTest: ${error.message}`);
}

async function cleanupWhatsAppInstances() {
  await supabase
    .from('whatsapp_instances')
    .delete()
    .eq('organization_id', TEST_ORG_ID)
    .like('instance_name', 'qa-%');
}

async function cleanupCopilotAgents() {
  await supabase
    .from('copilot_agents')
    .delete()
    .eq('organization_id', TEST_ORG_ID)
    .like('name', 'qa-%');
}

async function resetQuotas() {
  await supabase
    .from('org_quotas')
    .update({ plan_base: 0, purchased_addons: 0, admin_adjustment: 0 })
    .eq('organization_id', TEST_ORG_ID);
}

// ─── Tests ────────────────────────────────────────────────────

describe.skipIf(shouldSkip)('org-quota-enforcement — integration', () => {
  beforeAll(async () => {
    // Get a valid auth user for FK constraints
    const { data } = await supabase.auth.admin.listUsers({ perPage: 1 });
    VALID_USER_ID = data.users[0]?.id ?? '';
    if (!VALID_USER_ID) throw new Error('No auth users found — cannot run copilot trigger tests');
  });

  afterAll(async () => {
    await cleanupWhatsAppInstances();
    await cleanupCopilotAgents();
    await resetQuotas();
    // Clean audit log entries from tests
    await supabase
      .from('quota_audit_log')
      .delete()
      .eq('organization_id', TEST_ORG_ID)
      .like('change_reason', 'qa_%');
  });

  // ═══════════════════════════════════════════════════════════
  // 1. Generated column tests
  // ═══════════════════════════════════════════════════════════

  describe('org_quotas generated column', () => {
    it('computes effective_limit = plan_base + addons + adjustment', async () => {
      await setQuotaForTest('max_whatsapp_instances', 3, 2, 0);

      const { data } = await supabase
        .from('org_quotas')
        .select('effective_limit')
        .eq('organization_id', TEST_ORG_ID)
        .eq('resource_key', 'max_whatsapp_instances')
        .single();

      expect(data!.effective_limit).toBe(5);
    });

    it('returns -1 when plan_base is unlimited', async () => {
      await setQuotaForTest('max_whatsapp_instances', -1, 5, 10);

      const { data } = await supabase
        .from('org_quotas')
        .select('effective_limit')
        .eq('organization_id', TEST_ORG_ID)
        .eq('resource_key', 'max_whatsapp_instances')
        .single();

      expect(data!.effective_limit).toBe(-1);
    });

    it('floors effective_limit at 0 when adjustment is negative', async () => {
      await setQuotaForTest('max_whatsapp_instances', 2, 0, -5);

      const { data } = await supabase
        .from('org_quotas')
        .select('effective_limit')
        .eq('organization_id', TEST_ORG_ID)
        .eq('resource_key', 'max_whatsapp_instances')
        .single();

      expect(data!.effective_limit).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 2. org_resolve_quota RPC
  // ═══════════════════════════════════════════════════════════

  describe('org_resolve_quota', () => {
    beforeEach(async () => {
      await cleanupWhatsAppInstances();
    });

    it('returns correct breakdown with no usage', async () => {
      await setQuotaForTest('max_whatsapp_instances', 3, 2, 0);

      const { data, error } = await supabase.rpc('org_resolve_quota', {
        p_org_id: TEST_ORG_ID,
        p_resource_key: 'max_whatsapp_instances',
      });

      expect(error).toBeNull();
      expect(data.plan_base).toBe(3);
      expect(data.purchased_addons).toBe(2);
      expect(data.admin_adjustment).toBe(0);
      expect(data.effective_limit).toBe(5);
      expect(data.current_usage).toBe(0);
      expect(data.is_unlimited).toBe(false);
      expect(data.can_add).toBe(true);
      expect(data.remaining).toBe(5);
    });

    it('returns can_add=false when usage >= limit', async () => {
      await setQuotaForTest('max_whatsapp_instances', 1, 0, 0);

      // Create 1 instance to hit the limit
      await supabase.from('whatsapp_instances').insert({
        organization_id: TEST_ORG_ID,
        instance_name: 'qa-resolve-test',
      });

      const { data } = await supabase.rpc('org_resolve_quota', {
        p_org_id: TEST_ORG_ID,
        p_resource_key: 'max_whatsapp_instances',
      });

      expect(data.current_usage).toBe(1);
      expect(data.effective_limit).toBe(1);
      expect(data.can_add).toBe(false);
      expect(data.remaining).toBe(0);
    });

    it('returns unlimited when plan_base = -1', async () => {
      await setQuotaForTest('max_whatsapp_instances', -1, 0, 0);

      const { data } = await supabase.rpc('org_resolve_quota', {
        p_org_id: TEST_ORG_ID,
        p_resource_key: 'max_whatsapp_instances',
      });

      expect(data.is_unlimited).toBe(true);
      expect(data.can_add).toBe(true);
      expect(data.remaining).toBe(-1);
      expect(data.effective_limit).toBe(-1);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 3. org_resolve_all_quotas RPC
  // ═══════════════════════════════════════════════════════════

  describe('org_resolve_all_quotas', () => {
    it('returns all 3 resource keys', async () => {
      const { data, error } = await supabase.rpc('org_resolve_all_quotas', {
        p_org_id: TEST_ORG_ID,
      });

      expect(error).toBeNull();
      expect(data).toHaveProperty('max_whatsapp_instances');
      expect(data).toHaveProperty('max_users');
      expect(data).toHaveProperty('max_copilot_agents');

      // Each should have the standard shape
      for (const key of ['max_whatsapp_instances', 'max_users', 'max_copilot_agents']) {
        const q = data[key];
        expect(q).toHaveProperty('plan_base');
        expect(q).toHaveProperty('purchased_addons');
        expect(q).toHaveProperty('admin_adjustment');
        expect(q).toHaveProperty('effective_limit');
        expect(q).toHaveProperty('current_usage');
        expect(q).toHaveProperty('is_unlimited');
        expect(q).toHaveProperty('can_add');
        expect(q).toHaveProperty('remaining');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 4. WhatsApp trigger enforcement
  // ═══════════════════════════════════════════════════════════

  describe('enforce_whatsapp_instance_limit trigger', () => {
    beforeEach(async () => {
      await cleanupWhatsAppInstances();
    });

    it('allows INSERT when under limit', async () => {
      await setQuotaForTest('max_whatsapp_instances', 2, 0, 0);

      const { error } = await supabase.from('whatsapp_instances').insert({
        organization_id: TEST_ORG_ID,
        instance_name: 'qa-trigger-ok',
      });

      expect(error).toBeNull();
    });

    it('blocks INSERT when at limit with P0001', async () => {
      await setQuotaForTest('max_whatsapp_instances', 1, 0, 0);

      // Fill the quota
      await supabase.from('whatsapp_instances').insert({
        organization_id: TEST_ORG_ID,
        instance_name: 'qa-trigger-fill',
      });

      // This should fail
      const { error } = await supabase.from('whatsapp_instances').insert({
        organization_id: TEST_ORG_ID,
        instance_name: 'qa-trigger-blocked',
      });

      expect(error).not.toBeNull();
      expect(error!.code).toBe('P0001');
      expect(error!.message).toContain('Limite de instâncias WhatsApp atingido');
    });

    it('allows INSERT when unlimited', async () => {
      await setQuotaForTest('max_whatsapp_instances', -1, 0, 0);

      const { error: e1 } = await supabase.from('whatsapp_instances').insert({
        organization_id: TEST_ORG_ID,
        instance_name: 'qa-trigger-unlimited-1',
      });
      const { error: e2 } = await supabase.from('whatsapp_instances').insert({
        organization_id: TEST_ORG_ID,
        instance_name: 'qa-trigger-unlimited-2',
      });

      expect(e1).toBeNull();
      expect(e2).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 5. Copilot trigger enforcement
  // ═══════════════════════════════════════════════════════════

  describe('enforce_copilot_agent_limit trigger', () => {
    beforeEach(async () => {
      await cleanupCopilotAgents();
    });

    it('blocks INSERT when at limit', async () => {
      await setQuotaForTest('max_copilot_agents', 0, 0, 0);

      const { error } = await supabase.from('copilot_agents').insert({
        organization_id: TEST_ORG_ID,
        name: 'qa-copilot-blocked',
        main_objective: 'QA test',
        created_by: VALID_USER_ID,
      });

      expect(error).not.toBeNull();
      expect(error!.code).toBe('P0001');
      expect(error!.message).toContain('Limite de agentes Copilot atingido');
    });

    it('allows INSERT when under limit', async () => {
      await setQuotaForTest('max_copilot_agents', 2, 0, 0);

      const { error } = await supabase.from('copilot_agents').insert({
        organization_id: TEST_ORG_ID,
        name: 'qa-copilot-ok',
        main_objective: 'QA test',
        created_by: VALID_USER_ID,
      });

      expect(error).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 6. admin_set_purchased_addons (service_role)
  // ═══════════════════════════════════════════════════════════

  describe('admin_set_purchased_addons', () => {
    it('updates purchased_addons and creates audit log', async () => {
      await setQuotaForTest('max_whatsapp_instances', 1, 0, 0);

      const { data, error } = await supabase.rpc('admin_set_purchased_addons', {
        p_org_id: TEST_ORG_ID,
        p_resource_key: 'max_whatsapp_instances',
        p_purchased: 3,
        p_reason: 'qa_integration_test',
      });

      expect(error).toBeNull();
      expect(data.purchased_addons).toBe(3);
      expect(data.effective_limit).toBe(4); // 1 + 3

      // Verify audit log
      const { data: audit } = await supabase
        .from('quota_audit_log')
        .select('*')
        .eq('organization_id', TEST_ORG_ID)
        .eq('change_reason', 'qa_integration_test')
        .order('created_at', { ascending: false })
        .limit(1);

      expect(audit).toHaveLength(1);
      expect(audit![0].field_changed).toBe('purchased_addons');
      expect(audit![0].new_value).toBe(3);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 7. sync_org_quotas_from_plan
  // ═══════════════════════════════════════════════════════════

  describe('sync_org_quotas_from_plan', () => {
    it('runs without error for service_role', async () => {
      const { error } = await supabase.rpc('sync_org_quotas_from_plan', {
        p_org_id: TEST_ORG_ID,
      });

      expect(error).toBeNull();
    });

    it('preserves purchased_addons when syncing plan_base', async () => {
      // Set addons first
      await setQuotaForTest('max_whatsapp_instances', 3, 5, 0);

      // Sync from plan (QA org has no plan, so plan_base → 0)
      await supabase.rpc('sync_org_quotas_from_plan', {
        p_org_id: TEST_ORG_ID,
      });

      const { data } = await supabase
        .from('org_quotas')
        .select('plan_base, purchased_addons')
        .eq('organization_id', TEST_ORG_ID)
        .eq('resource_key', 'max_whatsapp_instances')
        .single();

      // plan_base reset to 0 (no plan), but addons preserved
      expect(data!.plan_base).toBe(0);
      expect(data!.purchased_addons).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 8. org_get_features_and_limits integration
  // ═══════════════════════════════════════════════════════════

  describe('org_get_features_and_limits reads from org_quotas', () => {
    it('returns effective_limit from org_quotas when rows exist', async () => {
      await setQuotaForTest('max_whatsapp_instances', 3, 2, 1);

      const { data, error } = await supabase.rpc('org_get_features_and_limits', {
        p_org_id: TEST_ORG_ID,
      });

      expect(error).toBeNull();
      // effective_limit = 3 + 2 + 1 = 6
      expect(data.limits.max_whatsapp_instances).toBe(6);
    });
  });
});
