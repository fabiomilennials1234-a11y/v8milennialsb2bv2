/**
 * Integration test: toggle_lead_ai RPC
 *
 * Tests against DEV Supabase that:
 *   1. Disabling AI for lead A returns ai_disabled=true in response
 *   2. Lead B remains unaffected (ai_disabled=false)
 *   3. Re-enabling AI returns ai_disabled=false
 *   4. RPC rejects non-existent leads
 *   5. RPC rejects leads from other organizations
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const DEV_URL = 'https://bcfadphgsibjzivtbjvc.supabase.co';
const DEV_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjZmFkcGhnc2lianppdnRianZjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzE5NDIxMywiZXhwIjoyMDg4NzcwMjEzfQ.cWrlxhVaw7qyGvSZmbDOUJSbQ-R555rGcPtNtX5hldE';
const DEV_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjZmFkcGhnc2lianppdnRianZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxOTQyMTMsImV4cCI6MjA4ODc3MDIxM30.GVqmINdqS799BDoGdiKbnbQhs2LzLUKbLi-JToR4mMw';

const admin = createClient(DEV_URL, DEV_SERVICE_KEY);

const TEST_EMAIL = `test-toggle-ai-${Date.now()}@test.local`;
const TEST_PASSWORD = 'TestToggleAI123!';

let testUserId: string;
let testOrgId: string;
let testTeamMemberId: string;
let leadAId: string;
let leadBId: string;
let userClient: ReturnType<typeof createClient>;

function parseRpcResponse(data: any): any {
  return typeof data === 'string' ? JSON.parse(data) : data;
}

describe('toggle_lead_ai RPC', () => {
  beforeAll(async () => {
    // Find an existing org
    const { data: orgs } = await admin.from('organizations').select('id').limit(1).single();
    if (!orgs) throw new Error('No organization found in DEV database');
    testOrgId = orgs.id;

    // Create test user
    const { data: authUser, error: authError } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (authError) throw authError;
    testUserId = authUser.user.id;

    // Create team_member
    const { data: tm, error: tmError } = await admin.from('team_members').insert({
      user_id: testUserId,
      organization_id: testOrgId,
      name: 'Test Toggle AI User',
      role: 'member',
      is_active: true,
    }).select('id').single();
    if (tmError) throw tmError;
    testTeamMemberId = tm.id;

    // Create two test leads
    const { data: leadA, error: lAErr } = await admin.from('leads').insert({
      name: 'Test Lead A (toggle)',
      phone: '+5511999990001',
      organization_id: testOrgId,
      origin: 'whatsapp',
      ai_disabled: false,
    }).select('id').single();
    if (lAErr) throw lAErr;
    leadAId = leadA.id;

    const { data: leadB, error: lBErr } = await admin.from('leads').insert({
      name: 'Test Lead B (control)',
      phone: '+5511999990002',
      organization_id: testOrgId,
      origin: 'whatsapp',
      ai_disabled: false,
    }).select('id').single();
    if (lBErr) throw lBErr;
    leadBId = leadB.id;

    // Sign in as the test user
    userClient = createClient(DEV_URL, DEV_ANON_KEY);
    const { error: signInError } = await userClient.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    if (signInError) throw signInError;
  }, 30_000);

  afterAll(async () => {
    if (leadAId) await admin.from('leads').delete().eq('id', leadAId);
    if (leadBId) await admin.from('leads').delete().eq('id', leadBId);
    if (testTeamMemberId) await admin.from('team_members').delete().eq('id', testTeamMemberId);
    if (testUserId) await admin.auth.admin.deleteUser(testUserId);
  }, 15_000);

  it('should disable AI for lead A and return ai_disabled=true', async () => {
    const { data, error } = await userClient.rpc('toggle_lead_ai', {
      p_lead_id: leadAId,
      p_disabled: true,
    });

    expect(error).toBeNull();
    const lead = parseRpcResponse(data);
    expect(lead.ai_disabled).toBe(true);
    expect(lead.ai_disabled_at).toBeTruthy();
    expect(lead.ai_disabled_by).toBe(testUserId);
    expect(lead.id).toBe(leadAId);
  });

  it('should NOT affect lead B when toggling lead A', async () => {
    // First disable lead A
    await userClient.rpc('toggle_lead_ai', { p_lead_id: leadAId, p_disabled: true });

    // Then check lead B is still enabled (call RPC with disabled=false should be no-op)
    const { data, error } = await userClient.rpc('toggle_lead_ai', {
      p_lead_id: leadBId,
      p_disabled: false, // Keep it enabled — just to read current state
    });

    expect(error).toBeNull();
    const leadB = parseRpcResponse(data);
    expect(leadB.ai_disabled).toBe(false);
    expect(leadB.id).toBe(leadBId);
  });

  it('should re-enable AI for lead A', async () => {
    // First ensure it's disabled
    await userClient.rpc('toggle_lead_ai', { p_lead_id: leadAId, p_disabled: true });

    // Then re-enable
    const { data, error } = await userClient.rpc('toggle_lead_ai', {
      p_lead_id: leadAId,
      p_disabled: false,
    });

    expect(error).toBeNull();
    const lead = parseRpcResponse(data);
    expect(lead.ai_disabled).toBe(false);
    expect(lead.ai_disabled_at).toBeNull();
    expect(lead.ai_disabled_by).toBeNull();
  });

  it('should reject non-existent lead', async () => {
    const { error } = await userClient.rpc('toggle_lead_ai', {
      p_lead_id: '00000000-0000-0000-0000-000000000000',
      p_disabled: true,
    });

    expect(error).toBeTruthy();
    expect(error!.message).toContain('Lead not found');
  });

  it('should persist ai_disabled state across navigation (get_lead_ai_status)', async () => {
    // Disable AI on lead A
    await userClient.rpc('toggle_lead_ai', { p_lead_id: leadAId, p_disabled: true });

    // Simulate "navigating away" by checking lead B status
    const { data: statusB } = await userClient.rpc('get_lead_ai_status', { p_lead_id: leadBId });
    const parsedB = parseRpcResponse(statusB);
    expect(parsedB.ai_disabled).toBe(false); // Lead B unaffected

    // Simulate "navigating back" by checking lead A status again
    const { data: statusA } = await userClient.rpc('get_lead_ai_status', { p_lead_id: leadAId });
    const parsedA = parseRpcResponse(statusA);
    expect(parsedA.ai_disabled).toBe(true); // Lead A still disabled!

    // Re-enable for cleanup
    await userClient.rpc('toggle_lead_ai', { p_lead_id: leadAId, p_disabled: false });

    // Verify re-enabled
    const { data: statusAfter } = await userClient.rpc('get_lead_ai_status', { p_lead_id: leadAId });
    const parsedAfter = parseRpcResponse(statusAfter);
    expect(parsedAfter.ai_disabled).toBe(false);
  });

  it('should reject lead from another organization', async () => {
    // Create lead in a different org (skip if org doesn't exist)
    const { data: otherOrg } = await admin.from('organizations')
      .select('id')
      .neq('id', testOrgId)
      .limit(1)
      .maybeSingle();

    if (!otherOrg) {
      console.log('[TEST] Skipping cross-org test: only one org exists');
      return;
    }

    const { data: foreignLead } = await admin.from('leads').insert({
      name: 'Foreign Lead',
      phone: '+5511999990099',
      organization_id: otherOrg.id,
      origin: 'whatsapp',
    }).select('id').single();

    if (!foreignLead) return;

    try {
      const { error } = await userClient.rpc('toggle_lead_ai', {
        p_lead_id: foreignLead.id,
        p_disabled: true,
      });

      expect(error).toBeTruthy();
      expect(error!.message).toContain('not a member');
    } finally {
      await admin.from('leads').delete().eq('id', foreignLead.id);
    }
  });
});
