import { test, expect } from '@playwright/test';

const org = '00000000-0000-0000-0000-000000000001';
const connection = 'e2e00000-0000-4000-8000-000000000001';
const metaPage = 'e2e00000-0000-4000-8000-000000000002';
const conversation = 'e2e00000-0000-4000-8000-000000000003';

test('Meta inbox mostra entrada e resposta confirmada pelo servidor', async ({ page, request }) => {
  const url = process.env.SUPABASE_URL!;
  // These destructive fixture operations are only permitted on the CI stack.
  expect(new URL(url).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  expect(key).toBeTruthy();
  const headers = { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'resolution=merge-duplicates' };
  async function insert(table: string, data: object) {
    const response = await request.post(`${url}/rest/v1/${table}`, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
  }
  await insert('meta_connections', { id: connection, organization_id: org,
    user_id: '00000000-0000-0000-0000-000000000020', facebook_user_id: 'e2e-user',
    access_token: 'offline-fixture-never-send', token_expires_at: new Date(Date.now() + 86400000).toISOString(),
    status: 'connected', connection_type: 'facebook' });
  await insert('meta_pages', { id: metaPage, meta_connection_id: connection, organization_id: org,
    page_id: 'e2e-meta-page', page_name: 'E2E Meta Page', page_access_token: 'offline-fixture-never-send',
    is_active: true, webhook_subscribed: true });
  await request.delete(`${url}/rest/v1/channel_messages?organization_id=eq.${org}&page_id=eq.e2e-meta-page`, { headers });
  const timestamp = new Date().toISOString();
  await insert('meta_conversations', { id: conversation, organization_id: org, meta_page_id: metaPage,
    channel: 'messenger', external_user_id: 'e2e-sender', external_username: 'E2E Sender',
    last_message_at: timestamp, last_inbound_at: timestamp, last_message_preview: 'olá do e2e', unread_count: 1 });
  await insert('channel_messages', { organization_id: org, channel: 'messenger', page_id: 'e2e-meta-page',
    external_id: `in-${Date.now()}`, sender_id: 'e2e-sender', direction: 'incoming',
    content: 'olá do e2e', message_type: 'text', status: 'received', timestamp });

  // No call is allowed to reach Meta. The stub persists what the server would
  // persist, so the browser must actually refetch the outgoing message.
  await page.route('**/functions/v1/send-meta-message', async route => {
    const body = route.request().postDataJSON();
    expect(body.organization_id).toBe(org);
    expect(body.conversationId).toBe(conversation);
    expect(body.message).toBe('resposta e2e');
    await insert('channel_messages', { organization_id: org, channel: 'messenger', page_id: 'e2e-meta-page',
      external_id: `out-${Date.now()}`, sender_id: 'e2e-sender', direction: 'outgoing',
      content: body.message, message_type: 'text', status: 'sent', timestamp: new Date().toISOString() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await page.goto('/atendimento/meta');
  await page.getByText('olá do e2e', { exact: true }).click();
  const composer = page.getByPlaceholder('Escreva sua mensagem...', { exact: true });
  await expect(composer).toBeEnabled();
  await expect(page.getByText('olá do e2e', { exact: true }).last()).toBeVisible();
  await composer.fill('resposta e2e');
  await composer.press('Enter');
  await expect(page.getByText('resposta e2e', { exact: true })).toBeVisible();
});
