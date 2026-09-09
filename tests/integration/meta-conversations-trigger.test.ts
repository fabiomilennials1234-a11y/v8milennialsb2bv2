// tests/integration/meta-conversations-trigger.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { TEST_ADMIN_ID } from './setup';
import { deleteFixtureOrganization } from './organization-fixture';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let supabase: SupabaseClient;
let orgId: string;
let pageRowId: string;
let connRowId: string;
const pageIdString = 'fb_page_123';

beforeAll(async () => {
  supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // create org
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .insert({ name: 'meta-trigger-test-org', slug: `meta-trigger-${crypto.randomUUID()}` })
    .select('id')
    .single();
  expect(orgError).toBeNull();
  orgId = org!.id;

  // create meta_connection + meta_page
  const { data: conn, error: connError } = await supabase
    .from('meta_connections')
    .insert({
      organization_id: orgId,
      user_id: TEST_ADMIN_ID,
      facebook_user_id: 'fb_user_test',
      facebook_user_name: 'Test',
      access_token: 'test_token',
      token_expires_at: new Date(Date.now() + 86400000).toISOString(),
      status: 'connected',
      connected_at: new Date().toISOString(),
      connection_type: 'facebook',
    })
    .select('id')
    .single();
  expect(connError).toBeNull();
  connRowId = conn!.id;

  const { data: page, error: pageError } = await supabase
    .from('meta_pages')
    .insert({
      meta_connection_id: conn!.id,
      organization_id: orgId,
      page_id: pageIdString,
      page_name: 'Test Page',
      page_access_token: 'page_token',
      is_active: true,
      webhook_subscribed: true,
    })
    .select('id')
    .single();
  expect(pageError).toBeNull();
  pageRowId = page!.id;
});

afterEach(async () => {
  await supabase.from('meta_conversations').delete().eq('organization_id', orgId);
  await supabase.from('channel_messages').delete().eq('organization_id', orgId);
});

afterAll(async () => {
  // Don't leak the seed orgs / pages / connections beyond this suite.
  await supabase.from('meta_conversations').delete().eq('organization_id', orgId);
  await supabase.from('channel_messages').delete().eq('organization_id', orgId);
  await supabase.from('leads').delete().eq('organization_id', orgId);
  await supabase.from('meta_pages').delete().eq('id', pageRowId);
  await supabase.from('meta_connections').delete().eq('id', connRowId);
  if (orgId) await deleteFixtureOrganization(supabase, orgId);
});

async function upsertConversation(opts: Partial<{
  direction: string;
  channel: string;
  content: string | null;
  sender_id: string;
  lead_id: string | null;
  timestamp: string;
  organization_id: string;
  meta_page_id: string;
}>) {
  const ts = opts.timestamp ?? new Date().toISOString();
  return supabase.rpc('upsert_meta_conversation', {
    p_organization_id: opts.organization_id ?? orgId,
    p_meta_page_id: opts.meta_page_id ?? pageRowId,
    p_channel: opts.channel ?? 'instagram',
    p_external_user_id: opts.sender_id ?? 'user_abc',
    p_direction: opts.direction ?? 'incoming',
    p_message_at: ts,
    p_preview: opts.content === undefined ? 'hello' : opts.content,
    p_lead_id: opts.lead_id ?? null,
    p_bump_unread: opts.direction !== 'outgoing',
  });
}

describe('upsert_meta_conversation RPC', () => {
  it('creates a conversation on first inbound message', async () => {
    const { error } = await upsertConversation({ direction: 'incoming', content: 'hi' });
    expect(error).toBeNull();

    const { data } = await supabase
      .from('meta_conversations')
      .select('*')
      .eq('organization_id', orgId);

    expect(data).toHaveLength(1);
    expect(data![0].unread_count).toBe(1);
    expect(data![0].last_message_preview).toBe('hi');
    expect(data![0].last_inbound_at).not.toBeNull();
    expect(data![0].external_user_id).toBe('user_abc');
    expect(data![0].channel).toBe('instagram');
    expect(data![0].meta_page_id).toBe(pageRowId);
  });

  it('increments unread on second inbound', async () => {
    expect((await upsertConversation({ direction: 'incoming', content: 'one' })).error).toBeNull();
    expect((await upsertConversation({ direction: 'incoming', content: 'two' })).error).toBeNull();

    const { data } = await supabase
      .from('meta_conversations')
      .select('unread_count, last_message_preview')
      .eq('organization_id', orgId)
      .single();

    expect(data!.unread_count).toBe(2);
    expect(data!.last_message_preview).toBe('two');
  });

  it('does not increment unread on outgoing', async () => {
    expect((await upsertConversation({ direction: 'incoming', content: 'in' })).error).toBeNull();
    expect((await upsertConversation({ direction: 'outgoing', content: 'out' })).error).toBeNull();

    const { data } = await supabase
      .from('meta_conversations')
      .select('unread_count, last_message_preview, last_inbound_at')
      .eq('organization_id', orgId)
      .single();

    expect(data!.unread_count).toBe(1);
    expect(data!.last_message_preview).toBe('out');
    // last_inbound_at must remain set
    expect(data!.last_inbound_at).not.toBeNull();
  });

  it('accepts the media preview supplied by the webhook', async () => {
    const { error } = await upsertConversation({ direction: 'incoming', content: '[image]' });
    expect(error).toBeNull();

    const { data } = await supabase
      .from('meta_conversations')
      .select('last_message_preview')
      .eq('organization_id', orgId)
      .single();

    expect(data!.last_message_preview).toBe('[image]');
  });

  it('propagates lead_id (sticky via COALESCE)', async () => {
    const { data: lead } = await supabase
      .from('leads')
      .insert({ organization_id: orgId, name: 'L', origin: 'meta_chat' })
      .select('id')
      .single();

    expect((await upsertConversation({ direction: 'incoming', lead_id: lead!.id })).error).toBeNull();
    expect((await upsertConversation({ direction: 'incoming', lead_id: null })).error).toBeNull();

    const { data } = await supabase
      .from('meta_conversations')
      .select('lead_id')
      .eq('organization_id', orgId)
      .single();

    expect(data!.lead_id).toBe(lead!.id);
  });

  it('rejects an unknown page', async () => {
    const { error } = await upsertConversation({
      meta_page_id: '00000000-0000-0000-0000-000000000000',
      sender_id: 'user_y',
    });
    expect(error).not.toBeNull();

    const { data } = await supabase
      .from('meta_conversations')
      .select('*')
      .eq('organization_id', orgId);

    expect(data).toHaveLength(0);
  });

  it('skips non-meta channels', async () => {
    const { error } = await upsertConversation({ channel: 'whatsapp', direction: 'incoming' });
    expect(error).not.toBeNull();

    const { data } = await supabase
      .from('meta_conversations')
      .select('*')
      .eq('organization_id', orgId);

    expect(data).toHaveLength(0);
  });

  it('isolates conversations across organizations', async () => {
    // Same external_user_id namespace, different org + meta_page. The trigger
    // keys on (organization_id, meta_page_id, channel, external_user_id), so
    // org B must get its own conversation row and org A must remain untouched.
    const { data: orgB, error: orgBError } = await supabase
      .from('organizations')
      .insert({ name: `iso-test-orgB-${Date.now()}`, slug: `iso-test-orgb-${crypto.randomUUID()}` })
      .select('id')
      .single();
    expect(orgBError).toBeNull();
    const { data: connB, error: connBError } = await supabase
      .from('meta_connections')
      .insert({
        organization_id: orgB!.id,
        user_id: TEST_ADMIN_ID,
        facebook_user_id: 'fb_iso_B',
        facebook_user_name: 'B',
        access_token: 'tB',
        token_expires_at: new Date(Date.now() + 86400000).toISOString(),
        status: 'connected',
        connected_at: new Date().toISOString(),
        connection_type: 'facebook',
      })
      .select('id')
      .single();
    expect(connBError).toBeNull();
    const { data: pageB, error: pageBError } = await supabase
      .from('meta_pages')
      .insert({
        meta_connection_id: connB!.id,
        organization_id: orgB!.id,
        page_id: 'iso_page_B',
        page_name: 'B',
        page_access_token: 't',
        is_active: true,
        webhook_subscribed: true,
      })
      .select('id')
      .single();
    expect(pageBError).toBeNull();

    try {
      // Inbound for org A (uses the suite-default page + sender 'user_abc').
      expect((await upsertConversation({ direction: 'incoming', content: 'orgA msg' })).error).toBeNull();

      // Inbound for org B with the same sender_id but different org + page.
      const resultB = await upsertConversation({
        organization_id: orgB!.id,
        meta_page_id: pageB!.id,
        sender_id: 'user_abc',
        direction: 'incoming',
        content: 'orgB msg',
      });
      expect(resultB.error).toBeNull();

      const { data: convsA } = await supabase
        .from('meta_conversations')
        .select('*')
        .eq('organization_id', orgId);
      const { data: convsB } = await supabase
        .from('meta_conversations')
        .select('*')
        .eq('organization_id', orgB!.id);

      expect(convsA).toHaveLength(1);
      expect(convsB).toHaveLength(1);
      expect(convsA![0].last_message_preview).toBe('orgA msg');
      expect(convsB![0].last_message_preview).toBe('orgB msg');
    } finally {
      await supabase.from('channel_messages').delete().eq('organization_id', orgB!.id);
      await supabase.from('meta_conversations').delete().eq('organization_id', orgB!.id);
      await supabase.from('meta_pages').delete().eq('id', pageB!.id);
      await supabase.from('meta_connections').delete().eq('id', connB!.id);
      await deleteFixtureOrganization(supabase, orgB!.id);
    }
  });
});
