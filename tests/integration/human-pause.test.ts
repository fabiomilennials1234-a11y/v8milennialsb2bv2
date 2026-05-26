/**
 * Integration test: Human Pause Copilot
 *
 * Tests against DEV Supabase:
 *   1. Manual outgoing message sets human_paused_until on conversation
 *   2. Second manual message resets timer (new timestamp > old)
 *   3. Copilot message (sent_source='copilot') does NOT trigger pause
 *   4. Agent with human_pause_enabled=false does NOT trigger pause
 *   5. No matching conversation → graceful skip (no error)
 *   6. clear_human_pause RPC clears the pause
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const PROD_URL = 'https://jsjsmuncfkbsbzqzqhfq.supabase.co';
const PROD_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzanNtdW5jZmtic2J6cXpxaGZxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTIxODc4MSwiZXhwIjoyMDg0Nzk0NzgxfQ.dcAGjeVLcMIh2x2JRdCYFmD_6Gtp8cdVxg4hL1dNz2w';
const PROD_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzanNtdW5jZmtic2J6cXpxaGZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyMTg3ODEsImV4cCI6MjA4NDc5NDc4MX0.rwmZh_bLyRIluqo0KN2TsK1PR2S0TriduUOzQ_RnaKQ';

const admin = createClient(PROD_URL, PROD_SERVICE_KEY);

const TEST_EMAIL = `test-human-pause-${Date.now()}@test.local`;
const TEST_PASSWORD = 'TestHumanPause123!';
const TEST_PHONE = '+5511999880001';
const TEST_INSTANCE_NAME = `test-hp-${Date.now()}`;

let testUserId: string;
let testOrgId: string;
let testTeamMemberId: string;
let testLeadId: string;
let testAgentId: string;
let testConversationId: string;
let testInstanceId: string;
let userClient: ReturnType<typeof createClient>;
let msgIdsToClean: string[] = [];

describe('Human Pause Copilot', () => {
  beforeAll(async () => {
    // Use Milennials org (has active copilot plan)
    testOrgId = '6030520a-2ca7-477d-be89-55758e2cd808';

    const { data: authUser, error: authError } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (authError) throw authError;
    testUserId = authUser.user.id;

    const { data: tm } = await admin.from('team_members').insert({
      user_id: testUserId,
      organization_id: testOrgId,
      name: 'Test Human Pause User',
      role: 'member',
      is_active: true,
    }).select('id').single();
    testTeamMemberId = tm!.id;

    const { data: lead } = await admin.from('leads').insert({
      name: 'Test Lead (human pause)',
      phone: TEST_PHONE,
      organization_id: testOrgId,
      origin: 'whatsapp',
    }).select('id').single();
    testLeadId = lead!.id;

    const { data: agent, error: agentErr } = await admin.from('copilot_agents').insert({
      name: `Test Agent HP ${Date.now()}`,
      organization_id: testOrgId,
      created_by: testUserId,
      main_objective: 'Test human pause feature',
      is_active: true,
      template_type: 'qualificador',
      human_pause_enabled: true,
      human_pause_duration_minutes: 60,
    }).select('id').single();
    if (agentErr) throw new Error(`Agent insert failed: ${agentErr.message}`);
    testAgentId = agent!.id;

    const { data: conv, error: convErr } = await admin.from('conversations').upsert({
      lead_id: testLeadId,
      organization_id: testOrgId,
      agent_id: testAgentId,
      state: 'QUALIFYING',
    }, { onConflict: 'lead_id' }).select('id').single();
    if (convErr) throw new Error(`Conversation insert failed: ${convErr.message}`);
    testConversationId = conv!.id;

    // Need a whatsapp instance for messages
    const { data: inst, error: instErr } = await admin.from('whatsapp_instances').upsert({
      organization_id: testOrgId,
      instance_name: TEST_INSTANCE_NAME,
      status: 'connected',
    }, { onConflict: 'organization_id,instance_name' }).select('id').single();
    if (instErr) throw new Error(`Instance upsert failed: ${instErr.message}`);
    testInstanceId = inst!.id;

    userClient = createClient(PROD_URL, PROD_ANON_KEY);
    await userClient.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
  }, 30_000);

  afterAll(async () => {
    for (const id of msgIdsToClean) {
      await admin.from('whatsapp_messages').delete().eq('id', id);
    }
    if (testConversationId) await admin.from('conversations').delete().eq('id', testConversationId);
    if (testAgentId) await admin.from('copilot_agents').delete().eq('id', testAgentId);
    if (testLeadId) await admin.from('leads').delete().eq('id', testLeadId);
    if (testTeamMemberId) await admin.from('team_members').delete().eq('id', testTeamMemberId);
    if (testInstanceId) await admin.from('whatsapp_instances').delete().eq('id', testInstanceId);
    if (testUserId) await admin.auth.admin.deleteUser(testUserId);
  }, 15_000);

  async function insertMessage(overrides: Record<string, any> = {}) {
    const msgId = `test-hp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const phone = overrides.phone_number ?? TEST_PHONE;
    const remoteJid = phone.replace('+', '') + '@s.whatsapp.net';
    const { data, error } = await admin.from('whatsapp_messages').insert({
      organization_id: testOrgId,
      instance_id: testInstanceId,
      message_id: msgId,
      phone_number: phone,
      remote_jid: remoteJid,
      direction: 'outgoing',
      message_type: 'text',
      content: 'test message',
      status: 'sent',
      sent_by_ai: false,
      sent_source: 'manual',
      lead_id: testLeadId,
      ...overrides,
    }).select('id').single();
    if (error) throw error;
    msgIdsToClean.push(data!.id);
    return data!;
  }

  async function getConversationPause() {
    const { data } = await admin.from('conversations')
      .select('human_paused_until')
      .eq('id', testConversationId)
      .single();
    return data?.human_paused_until;
  }

  async function clearPauseDirectly() {
    await admin.from('conversations')
      .update({ human_paused_until: null })
      .eq('id', testConversationId);
  }

  it('should set human_paused_until when manual outgoing message is sent', async () => {
    await clearPauseDirectly();

    await insertMessage();
    // Trigger fires synchronously on INSERT — no delay needed
    const pausedUntil = await getConversationPause();

    expect(pausedUntil).toBeTruthy();
    const pauseTime = new Date(pausedUntil!);
    const expectedMin = new Date(Date.now() + 59 * 60_000);
    const expectedMax = new Date(Date.now() + 61 * 60_000);
    expect(pauseTime.getTime()).toBeGreaterThan(expectedMin.getTime());
    expect(pauseTime.getTime()).toBeLessThan(expectedMax.getTime());
  });

  it('should reset timer on subsequent manual message', async () => {
    await clearPauseDirectly();

    await insertMessage();
    const firstPause = await getConversationPause();
    expect(firstPause).toBeTruthy();

    // Small delay to ensure different timestamp
    await new Promise(r => setTimeout(r, 50));

    await insertMessage();
    const secondPause = await getConversationPause();
    expect(secondPause).toBeTruthy();

    expect(new Date(secondPause!).getTime()).toBeGreaterThan(
      new Date(firstPause!).getTime()
    );
  });

  it('should NOT trigger pause for copilot messages', async () => {
    await clearPauseDirectly();

    await insertMessage({
      sent_source: 'copilot',
      sent_by_ai: true,
    });

    const pausedUntil = await getConversationPause();
    expect(pausedUntil).toBeNull();
  });

  it('should NOT trigger pause for workflow messages', async () => {
    await clearPauseDirectly();

    await insertMessage({
      sent_source: 'workflow',
      sent_by_ai: false,
    });

    const pausedUntil = await getConversationPause();
    expect(pausedUntil).toBeNull();
  });

  it('should NOT trigger pause when agent has human_pause_enabled=false', async () => {
    // Temporarily disable human_pause
    await admin.from('copilot_agents')
      .update({ human_pause_enabled: false })
      .eq('id', testAgentId);

    await clearPauseDirectly();
    await insertMessage();

    const pausedUntil = await getConversationPause();
    expect(pausedUntil).toBeNull();

    // Restore
    await admin.from('copilot_agents')
      .update({ human_pause_enabled: true })
      .eq('id', testAgentId);
  });

  it('should NOT error when no matching conversation exists', async () => {
    const otherPhone = '+5511999880099';
    const msgId = `test-hp-orphan-${Date.now()}`;
    const { error } = await admin.from('whatsapp_messages').insert({
      organization_id: testOrgId,
      instance_id: testInstanceId,
      message_id: msgId,
      phone_number: otherPhone,
      remote_jid: '5511999880099@s.whatsapp.net',
      direction: 'outgoing',
      message_type: 'text',
      content: 'orphan message',
      status: 'sent',
      sent_by_ai: false,
      sent_source: 'manual',
    }).select('id').single();

    expect(error).toBeNull();

    // Cleanup
    await admin.from('whatsapp_messages').delete().eq('message_id', msgId);
  });

  it('should respect custom duration from agent config', async () => {
    await admin.from('copilot_agents')
      .update({ human_pause_duration_minutes: 30 })
      .eq('id', testAgentId);

    await clearPauseDirectly();
    await insertMessage();

    const pausedUntil = await getConversationPause();
    expect(pausedUntil).toBeTruthy();

    const pauseTime = new Date(pausedUntil!);
    const expectedMin = new Date(Date.now() + 29 * 60_000);
    const expectedMax = new Date(Date.now() + 31 * 60_000);
    expect(pauseTime.getTime()).toBeGreaterThan(expectedMin.getTime());
    expect(pauseTime.getTime()).toBeLessThan(expectedMax.getTime());

    // Restore
    await admin.from('copilot_agents')
      .update({ human_pause_duration_minutes: 60 })
      .eq('id', testAgentId);
  });

  it('should clear pause via clear_human_pause RPC', async () => {
    // Set pause first
    await insertMessage();
    const before = await getConversationPause();
    expect(before).toBeTruthy();

    // Call RPC as authenticated user
    const { error } = await userClient.rpc('clear_human_pause', {
      p_conversation_id: testConversationId,
    });
    expect(error).toBeNull();

    const after = await getConversationPause();
    expect(after).toBeNull();
  });

  it('should reject clear_human_pause for non-existent conversation', async () => {
    const { error } = await userClient.rpc('clear_human_pause', {
      p_conversation_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(error).toBeTruthy();
    expect(error!.message).toContain('Conversation not found');
  });

  it('should NOT trigger pause for incoming messages', async () => {
    await clearPauseDirectly();

    await insertMessage({
      direction: 'incoming',
      sent_source: 'manual',
      sent_by_ai: false,
    });

    const pausedUntil = await getConversationPause();
    expect(pausedUntil).toBeNull();
  });
});
