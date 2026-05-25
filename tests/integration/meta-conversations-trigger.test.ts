// tests/integration/meta-conversations-trigger.test.ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let supabase: SupabaseClient;
let orgId: string;
let pageRowId: string;
const pageIdString = 'fb_page_123';

beforeAll(async () => {
  supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // create org
  const { data: org } = await supabase
    .from('organizations')
    .insert({ name: 'meta-trigger-test-org' })
    .select('id')
    .single();
  orgId = org!.id;

  // create meta_connection + meta_page
  const { data: conn } = await supabase
    .from('meta_connections')
    .insert({
      organization_id: orgId,
      user_id: '00000000-0000-0000-0000-000000000000',
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

  const { data: page } = await supabase
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
  pageRowId = page!.id;
});

afterEach(async () => {
  await supabase.from('meta_conversations').delete().eq('organization_id', orgId);
  await supabase.from('channel_messages').delete().eq('organization_id', orgId);
});

async function insertMsg(opts: Partial<{
  direction: string;
  channel: string;
  content: string | null;
  message_type: string;
  sender_id: string;
  lead_id: string | null;
  timestamp: string;
}>) {
  const ts = opts.timestamp ?? new Date().toISOString();
  return supabase.from('channel_messages').insert({
    organization_id: orgId,
    channel: opts.channel ?? 'instagram',
    page_id: pageIdString,
    external_id: `ext_${Math.random()}`,
    sender_id: opts.sender_id ?? 'user_abc',
    direction: opts.direction ?? 'incoming',
    message_type: opts.message_type ?? 'text',
    content: opts.content === undefined ? 'hello' : opts.content,
    status: opts.direction === 'outgoing' ? 'sent' : 'received',
    lead_id: opts.lead_id ?? null,
    timestamp: ts,
  });
}

describe('meta_conversations trigger', () => {
  it('creates a conversation on first inbound message', async () => {
    await insertMsg({ direction: 'incoming', content: 'hi' });

    const { data } = await supabase
      .from('meta_conversations')
      .select('*')
      .eq('organization_id', orgId);

    expect(data).toHaveLength(1);
    expect(data![0].unread_count).toBe(1);
    expect(data![0].last_message_preview).toBe('hi');
    expect(data![0].last_message_direction).toBe('incoming');
    expect(data![0].last_inbound_at).not.toBeNull();
    expect(data![0].external_user_id).toBe('user_abc');
    expect(data![0].channel).toBe('instagram');
    expect(data![0].meta_page_id).toBe(pageRowId);
  });

  it('increments unread on second inbound', async () => {
    await insertMsg({ direction: 'incoming', content: 'one' });
    await insertMsg({ direction: 'incoming', content: 'two' });

    const { data } = await supabase
      .from('meta_conversations')
      .select('unread_count, last_message_preview')
      .eq('organization_id', orgId)
      .single();

    expect(data!.unread_count).toBe(2);
    expect(data!.last_message_preview).toBe('two');
  });

  it('does not increment unread on outgoing', async () => {
    await insertMsg({ direction: 'incoming', content: 'in' });
    await insertMsg({ direction: 'outgoing', content: 'out' });

    const { data } = await supabase
      .from('meta_conversations')
      .select('unread_count, last_message_direction, last_inbound_at')
      .eq('organization_id', orgId)
      .single();

    expect(data!.unread_count).toBe(1);
    expect(data!.last_message_direction).toBe('outgoing');
    // last_inbound_at must remain set
    expect(data!.last_inbound_at).not.toBeNull();
  });

  it('uses [type] preview when content is null (media)', async () => {
    await insertMsg({ direction: 'incoming', content: null, message_type: 'image' });

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

    await insertMsg({ direction: 'incoming', lead_id: lead!.id });
    await insertMsg({ direction: 'incoming', lead_id: null });

    const { data } = await supabase
      .from('meta_conversations')
      .select('lead_id')
      .eq('organization_id', orgId)
      .single();

    expect(data!.lead_id).toBe(lead!.id);
  });

  it('skips when page is unknown', async () => {
    await supabase.from('channel_messages').insert({
      organization_id: orgId,
      channel: 'instagram',
      page_id: 'UNKNOWN_PAGE',
      external_id: 'ext_x',
      sender_id: 'user_y',
      direction: 'incoming',
      message_type: 'text',
      content: 'orphan',
      status: 'received',
      timestamp: new Date().toISOString(),
    });

    const { data } = await supabase
      .from('meta_conversations')
      .select('*')
      .eq('organization_id', orgId);

    expect(data).toHaveLength(0);
  });

  it('skips non-meta channels', async () => {
    await insertMsg({ channel: 'whatsapp', direction: 'incoming' });

    const { data } = await supabase
      .from('meta_conversations')
      .select('*')
      .eq('organization_id', orgId);

    expect(data).toHaveLength(0);
  });
});
