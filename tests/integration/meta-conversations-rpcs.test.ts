// tests/integration/meta-conversations-rpcs.test.ts
//
// Exercises mark_meta_conversation_read + link_meta_conversation_to_lead
// through an authenticated client so RLS / get_my_organization_ids() actually
// gates the call. Service-role bypasses these checks, so a service-role-only
// test would silently pass for the wrong reasons.
//
// Requires:
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY (for setup/teardown)
//   - SUPABASE_ANON_KEY (falls back to the well-known local seed)
//
// All seeded data is cleaned in afterEach / afterAll. No leaks.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { deleteFixtureOrganization } from './organization-fixture';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const TEST_PASSWORD = 'rpc-test-pwd-12345';
const pageIdString = 'fb_page_rpc';

let admin: SupabaseClient;
let userClient: SupabaseClient;
let otherUserClient: SupabaseClient;

let orgId: string;
let otherOrgId: string;
let pageRowId: string;
let otherPageRowId: string;
let connRowId: string;
let otherConnRowId: string;

let userId: string;
let otherUserId: string;
let userEmail: string;
let otherUserEmail: string;

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Orgs
  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({ name: `rpc-org-${Date.now()}`, slug: `rpc-org-${crypto.randomUUID()}` })
    .select('id')
    .single();
  expect(orgError).toBeNull();
  orgId = org!.id;
  const { data: other, error: otherOrgError } = await admin
    .from('organizations')
    .insert({ name: `rpc-other-org-${Date.now()}`, slug: `rpc-other-org-${crypto.randomUUID()}` })
    .select('id')
    .single();
  expect(otherOrgError).toBeNull();
  otherOrgId = other!.id;

  // Real auth users must exist before meta_connections references them.
  userEmail = `rpc-a-${Date.now()}@test.local`;
  otherUserEmail = `rpc-b-${Date.now()}@test.local`;

  const { data: u1, error: u1Err } = await admin.auth.admin.createUser({
    email: userEmail,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (u1Err) throw new Error(`createUser failed for org A: ${u1Err.message}`);
  userId = u1.user!.id;

  const { data: u2, error: u2Err } = await admin.auth.admin.createUser({
    email: otherUserEmail,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (u2Err) throw new Error(`createUser failed for org B: ${u2Err.message}`);
  otherUserId = u2.user!.id;

  const { error: quotaError } = await admin.from('org_quotas').upsert([
    { organization_id: orgId, resource_key: 'max_users', plan_base: 1 },
    { organization_id: otherOrgId, resource_key: 'max_users', plan_base: 1 },
  ], { onConflict: 'organization_id,resource_key' });
  expect(quotaError).toBeNull();

  const { error: memberError } = await admin.from('team_members').insert([
    {
      organization_id: orgId,
      user_id: userId,
      role: 'admin',
      name: 'Meta RPC Admin A',
      email: userEmail,
      is_active: true,
    },
    {
      organization_id: otherOrgId,
      user_id: otherUserId,
      role: 'admin',
      name: 'Meta RPC Admin B',
      email: otherUserEmail,
      is_active: true,
    },
  ]);
  expect(memberError).toBeNull();

  // Meta connection + page for org A
  const { data: conn, error: connError } = await admin
    .from('meta_connections')
    .insert({
      organization_id: orgId,
      user_id: userId,
      facebook_user_id: `fb_rpc_${Date.now()}`,
      facebook_user_name: 'T',
      access_token: 't',
      token_expires_at: new Date(Date.now() + 86400000).toISOString(),
      status: 'connected',
      connected_at: new Date().toISOString(),
      connection_type: 'facebook',
    })
    .select('id')
    .single();
  expect(connError).toBeNull();
  connRowId = conn!.id;

  const { data: page, error: pageError } = await admin
    .from('meta_pages')
    .insert({
      meta_connection_id: connRowId,
      organization_id: orgId,
      page_id: pageIdString,
      page_name: 'P',
      page_access_token: 'pt',
      is_active: true,
      webhook_subscribed: true,
    })
    .select('id')
    .single();
  expect(pageError).toBeNull();
  pageRowId = page!.id;

  // Meta connection + page for org B
  const { data: otherConn, error: otherConnError } = await admin
    .from('meta_connections')
    .insert({
      organization_id: otherOrgId,
      user_id: otherUserId,
      facebook_user_id: `fb_other_${Date.now()}`,
      facebook_user_name: 'O',
      access_token: 't',
      token_expires_at: new Date(Date.now() + 86400000).toISOString(),
      status: 'connected',
      connected_at: new Date().toISOString(),
      connection_type: 'facebook',
    })
    .select('id')
    .single();
  expect(otherConnError).toBeNull();
  otherConnRowId = otherConn!.id;

  const { data: otherPage, error: otherPageError } = await admin
    .from('meta_pages')
    .insert({
      meta_connection_id: otherConnRowId,
      organization_id: otherOrgId,
      page_id: 'other_page',
      page_name: 'OP',
      page_access_token: 't',
      is_active: true,
      webhook_subscribed: true,
    })
    .select('id')
    .single();
  expect(otherPageError).toBeNull();
  otherPageRowId = otherPage!.id;

  // Sign each user in to obtain a session JWT and build per-user clients.
  const tmpA = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: sessA, error: sessAErr } = await tmpA.auth.signInWithPassword({
    email: userEmail,
    password: TEST_PASSWORD,
  });
  if (sessAErr || !sessA.session) throw new Error(`sign-in A failed: ${sessAErr?.message}`);
  userClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  await userClient.auth.setSession({
    access_token: sessA.session.access_token,
    refresh_token: sessA.session.refresh_token,
  });

  const tmpB = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: sessB, error: sessBErr } = await tmpB.auth.signInWithPassword({
    email: otherUserEmail,
    password: TEST_PASSWORD,
  });
  if (sessBErr || !sessB.session) throw new Error(`sign-in B failed: ${sessBErr?.message}`);
  otherUserClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  await otherUserClient.auth.setSession({
    access_token: sessB.session.access_token,
    refresh_token: sessB.session.refresh_token,
  });
});

afterEach(async () => {
  await admin.from('meta_conversations').delete().eq('organization_id', orgId);
  await admin.from('meta_conversations').delete().eq('organization_id', otherOrgId);
  await admin.from('channel_messages').delete().eq('organization_id', orgId);
  await admin.from('channel_messages').delete().eq('organization_id', otherOrgId);
  await admin.from('leads').delete().eq('organization_id', orgId);
  await admin.from('leads').delete().eq('organization_id', otherOrgId);
});

afterAll(async () => {
  // Order matters: drop dependent rows first.
  await admin.from('meta_conversations').delete().eq('organization_id', orgId);
  await admin.from('meta_conversations').delete().eq('organization_id', otherOrgId);
  await admin.from('channel_messages').delete().eq('organization_id', orgId);
  await admin.from('channel_messages').delete().eq('organization_id', otherOrgId);
  await admin.from('leads').delete().eq('organization_id', orgId);
  await admin.from('leads').delete().eq('organization_id', otherOrgId);
  await admin.from('team_members').delete().eq('organization_id', orgId);
  await admin.from('team_members').delete().eq('organization_id', otherOrgId);
  await admin.from('meta_pages').delete().eq('id', pageRowId);
  await admin.from('meta_pages').delete().eq('id', otherPageRowId);
  await admin.from('meta_connections').delete().eq('id', connRowId);
  await admin.from('meta_connections').delete().eq('id', otherConnRowId);
  if (orgId) await deleteFixtureOrganization(admin, orgId);
  if (otherOrgId) await deleteFixtureOrganization(admin, otherOrgId);
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  if (otherUserId) await admin.auth.admin.deleteUser(otherUserId).catch(() => undefined);
});

async function seedConversation(opts: {
  unread?: number;
  lead_id?: string | null;
  org?: 'A' | 'B';
} = {}) {
  const useOrg = opts.org === 'B' ? otherOrgId : orgId;
  const usePage = opts.org === 'B' ? otherPageRowId : pageRowId;
  const sender = 'usr_x';

  const total = Math.max(1, opts.unread ?? 1);
  let conversationId = '';
  for (let i = 0; i < total; i++) {
    const { data, error } = await admin.rpc('upsert_meta_conversation', {
      p_organization_id: useOrg,
      p_meta_page_id: usePage,
      p_channel: 'instagram',
      p_external_user_id: sender,
      p_direction: 'incoming',
      p_message_at: new Date(Date.now() + i).toISOString(),
      p_preview: i === 0 ? 'hi' : `m${i}`,
      p_lead_id: opts.lead_id ?? null,
      p_bump_unread: true,
    });
    expect(error).toBeNull();
    conversationId = data as string;
  }
  return conversationId;
}

describe('mark_meta_conversation_read (authenticated)', () => {
  it('zeros unread_count for a conversation in the caller organization', async () => {
    const convId = await seedConversation({ unread: 3 });

    const { error } = await userClient.rpc('mark_meta_conversation_read', {
      p_conversation_id: convId,
    });
    expect(error).toBeNull();

    const { data: conv } = await admin
      .from('meta_conversations')
      .select('unread_count')
      .eq('id', convId)
      .single();
    expect(conv!.unread_count).toBe(0);
  });

  it('does not mutate a conversation from another organization', async () => {
    const convId = await seedConversation({ unread: 2 });

    const { error } = await otherUserClient.rpc('mark_meta_conversation_read', {
      p_conversation_id: convId,
    });
    expect(error).toBeNull();

    const { data: conv } = await admin
      .from('meta_conversations')
      .select('unread_count')
      .eq('id', convId)
      .single();
    expect(conv!.unread_count).toBe(2);
  });

  it('is idempotent for a nonexistent conversation UUID', async () => {
    const { error } = await userClient.rpc('mark_meta_conversation_read', {
      p_conversation_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(error).toBeNull();
  });
});

describe('link_meta_conversation_to_lead (authenticated)', () => {
  it('sets lead_id on the conversation', async () => {
    const convId = await seedConversation({ unread: 2 });

    const { data: lead } = await admin
      .from('leads')
      .insert({ organization_id: orgId, name: 'L', origin: 'meta_chat' })
      .select('id')
      .single();

    const { error } = await userClient.rpc('link_meta_conversation_to_lead', {
      p_conversation_id: convId,
      p_lead_id: lead!.id,
    });
    expect(error).toBeNull();

    const { data: conv } = await admin
      .from('meta_conversations')
      .select('lead_id')
      .eq('id', convId)
      .single();
    expect(conv!.lead_id).toBe(lead!.id);
  });

  it('raises forbidden when caller is not a member of the conversation org', async () => {
    const convId = await seedConversation();
    // Lead in the calling user's own org (org B), so the second guard is not reached.
    const { data: leadB } = await admin
      .from('leads')
      .insert({ organization_id: otherOrgId, name: 'LB', origin: 'meta_chat' })
      .select('id')
      .single();

    const { error } = await otherUserClient.rpc('link_meta_conversation_to_lead', {
      p_conversation_id: convId,
      p_lead_id: leadB!.id,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/conversa ou lead inexistente/);
  });

  it('raises lead_org_mismatch when caller is in conv org but lead is in another', async () => {
    const convId = await seedConversation();
    const { data: foreignLead } = await admin
      .from('leads')
      .insert({ organization_id: otherOrgId, name: 'foreign', origin: 'meta_chat' })
      .select('id')
      .single();

    const { error } = await userClient.rpc('link_meta_conversation_to_lead', {
      p_conversation_id: convId,
      p_lead_id: foreignLead!.id,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/conversa ou lead inexistente/);
  });

  it('raises conversation_not_found for a bogus conversation UUID', async () => {
    const { data: lead } = await admin
      .from('leads')
      .insert({ organization_id: orgId, name: 'L', origin: 'meta_chat' })
      .select('id')
      .single();

    const { error } = await userClient.rpc('link_meta_conversation_to_lead', {
      p_conversation_id: '00000000-0000-0000-0000-000000000000',
      p_lead_id: lead!.id,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/conversa ou lead inexistente/);
  });

  it('raises lead_not_found for a bogus lead UUID', async () => {
    const convId = await seedConversation();
    const { error } = await userClient.rpc('link_meta_conversation_to_lead', {
      p_conversation_id: convId,
      p_lead_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/conversa ou lead inexistente/);
  });
});
