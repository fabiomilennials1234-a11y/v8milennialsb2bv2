// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { WhatsAppWebhookOptions } from '../../supabase/functions/whatsapp-webhook/handler.ts';

vi.mock('../../supabase/functions/_shared/logger.ts', () => ({
  logRuntime: vi.fn(async () => {}), redactSecrets: (value: unknown) => value,
}));

const enabledId = '10000000-0000-0000-0000-000000000001';
const otherId = '20000000-0000-0000-0000-000000000002';
const organizationId = '30000000-0000-0000-0000-000000000003';
const env: Record<string, string> = {
  SUPABASE_URL: 'https://bridge-db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  UAZAPI_WEBHOOK_SECRET: 'fixture-secret',
};
type Admission = NonNullable<WhatsAppWebhookOptions['admitEvent']>;
let createBridge: (getEnv: (key: string) => string | undefined) => Admission;
let createHandler: (options?: WhatsAppWebhookOptions) => (req: Request) => Promise<Response>;
let resolvedId: string;
let databaseCalls: Array<{ url: string; method: string; body: unknown }>;
let enqueue: () => Response | Promise<Response>;
let beginExecution: () => Response | Promise<Response>;
let completeExecution: () => Response | Promise<Response>;
let writeReceipt: () => Response | Promise<Response>;
let groupPolicy: 'enabled' | 'disabled' | 'missing' | 'error';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
const bridge = () => createBridge(key => env[key]);
const webhook = (payload: unknown, secret = 'fixture-secret', pathHint?: string) =>
  new Request(`https://bridge.test/whatsapp-webhook/${secret}${pathHint ? `/${pathHint}` : ''}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
const run = (payload: unknown, secret?: string, pathHint?: string) =>
  createHandler({ admitEvent: bridge() })(webhook(payload, secret, pathHint));
const enqueues = () => databaseCalls.filter(call => call.url.includes('/rpc/enqueue_whatsapp_ingress_event'));
const begins = () => databaseCalls.filter(call => call.url.includes('/rpc/begin_whatsapp_edge_execution'));
const completions = () => databaseCalls.filter(call => call.url.includes('/rpc/complete_whatsapp_edge_execution'));
const statusWrites = () => databaseCalls.filter(call => call.url.includes('/whatsapp_messages') && call.method !== 'GET');

beforeAll(async () => {
  const serve = vi.fn();
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key], toObject: () => env }, serve });
  createHandler = (await import('../../supabase/functions/whatsapp-webhook/handler.ts')).createWhatsAppWebhookHandler;
  createBridge = (await import('../../supabase/functions/whatsapp-webhook/edge-inbox-bridge.ts')).createEdgeInboxBridge;
  expect(serve).not.toHaveBeenCalled();
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  delete env.WHATSAPP_EDGE_INBOX_ENABLED;
  delete env.WHATSAPP_EDGE_INBOX_INSTANCE_IDS;
  delete env.WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS;
  resolvedId = enabledId;
  databaseCalls = [];
  enqueue = async () => json('durable-event-id');
  beginExecution = async () => json({ mode: 'inline', ticket_id: enabledId });
  completeExecution = async () => json(true);
  writeReceipt = async () => json([]);
  groupPolicy = 'enabled';
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const rawBody = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    const body = typeof rawBody === 'string' && rawBody ? JSON.parse(rawBody) : null;
    databaseCalls.push({ url, method, body });
    if (url.includes('/rpc/check_rate_limit')) return json({ allowed: true, remaining: 100 });
    if (url.includes('/whatsapp_instance_secrets')) return json({ instance_id: resolvedId, organization_id: organizationId });
    if (url.includes('/whatsapp_instances')) return json({ id: resolvedId, organization_id: organizationId, provider: 'uazapi' });
    if (url.includes('/organizations')) {
      if (groupPolicy === 'error') return json({ code: 'P0001', message: 'policy unavailable' }, 503);
      if (groupPolicy === 'missing') return json(null);
      return json({ capture_groups: groupPolicy === 'enabled' });
    }
    if (url.includes('/rpc/enqueue_whatsapp_ingress_event')) return enqueue();
    if (url.includes('/rpc/begin_whatsapp_edge_execution')) return beginExecution();
    if (url.includes('/rpc/complete_whatsapp_edge_execution')) return completeExecution();
    if (url.includes('/whatsapp_messages')) return method === 'PATCH' ? writeReceipt()
      : env.WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS ? json([{ id: 'row-1', message_id: 'existing-message', status: 'sent', direction: 'outgoing', reactions: [] }]) : json([]);
    throw new Error(`Unexpected backend request: ${url}`);
  }));
});

it.each([undefined, 'false'])('keeps canonical handling when flag is %j', async value => {
  if (value !== undefined) env.WHATSAPP_EDGE_INBOX_ENABLED = value;
  const response = await run({ instance: 'provider-instance', event: 'messages_update', data: { id: 'existing-message', status: 'sent' } });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(enqueues()).toHaveLength(0);
  expect(statusWrites()).toHaveLength(1);
});

it.each(['', 'TRUE', '1', 'yes', 'false ', 'garbage'])('rejects ambiguous enablement %j', value => {
  env.WHATSAPP_EDGE_INBOX_ENABLED = value;
  env.WHATSAPP_EDGE_INBOX_INSTANCE_IDS = enabledId;
  expect(bridge).toThrow();
});

it.each(['', ' ', 'not-a-uuid', `${enabledId},`, `${enabledId},aaaaaaaa-0000-0000-0000-00000000000A`])('rejects an invalid enabled allowlist %j', value => {
  env.WHATSAPP_EDGE_INBOX_ENABLED = 'true';
  env.WHATSAPP_EDGE_INBOX_INSTANCE_IDS = value;
  expect(bridge).toThrow();
});

it('never reaches database on invalid webhook authentication', async () => {
  env.WHATSAPP_EDGE_INBOX_ENABLED = 'true';
  env.WHATSAPP_EDGE_INBOX_INSTANCE_IDS = enabledId;
  expect((await run({ instance: 'provider-instance', event: 'messages_update' }, 'wrong-secret')).status).toBe(404);
  expect(databaseCalls).toHaveLength(0);
});

it('uses the authenticated database tenant and instance, preserving the full V2 receipt and URL hint', async () => {
  env.WHATSAPP_EDGE_INBOX_ENABLED = 'true';
  env.WHATSAPP_EDGE_INBOX_INSTANCE_IDS = enabledId;
  const payload = {
    EventType: 'Messages_Update',
    event: { MessageIDs: ['receipt-1', 'receipt-2'], Type: 'read', IsFromMe: false, Chat: '5511999@s.whatsapp.net' },
    organization_id: 'forged-organization', instance_id: 'provider-instance',
    owner: '5511999', custom: { nested: ['vendor', 'fields'] },
  };
  const response = await run(payload, undefined, 'path-provider-instance');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ accepted: true });
  expect(enqueues()).toHaveLength(1);
  expect(enqueues()[0].body).toEqual({
    p_organization_id: organizationId, p_instance_id: enabledId,
    p_event_name: 'messages_update', p_payload: payload,
    p_path_instance_id: 'path-provider-instance',
  });
  expect(statusWrites()).toHaveLength(0);
});

it('does not admit a forged allowlisted payload when database resolves another instance', async () => {
  env.WHATSAPP_EDGE_INBOX_ENABLED = 'true';
  env.WHATSAPP_EDGE_INBOX_INSTANCE_IDS = enabledId;
  resolvedId = otherId;
  const response = await run({ instance: enabledId, organization_id: 'forged', event: 'messages_update', data: { id: 'existing-message', status: 'sent' } });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(enqueues()).toHaveLength(0);
  expect(statusWrites()).toHaveLength(1);
});

it('leaves other event types on the canonical handler path', async () => {
  env.WHATSAPP_EDGE_INBOX_ENABLED = 'true';
  env.WHATSAPP_EDGE_INBOX_INSTANCE_IDS = enabledId;
  const response = await run({ instance: 'provider-instance', event: 'unknown_vendor_event' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(enqueues()).toHaveLength(0);
});

it('waits for durable enqueue before acknowledging the provider', async () => {
  env.WHATSAPP_EDGE_INBOX_ENABLED = 'true';
  env.WHATSAPP_EDGE_INBOX_INSTANCE_IDS = enabledId;
  let finish!: (response: Response) => void;
  enqueue = () => new Promise(resolve => { finish = resolve; });
  let acknowledged = false;
  const pending = run({ instance: 'provider-instance', event: 'messages_update', data: {} })
    .then(response => { acknowledged = true; return response; });
  await vi.waitFor(() => expect(enqueues()).toHaveLength(1));
  expect(acknowledged).toBe(false);
  finish(json('durable-event-id'));
  expect((await pending).status).toBe(200);
  expect(statusWrites()).toHaveLength(0);
});

const groupReceipt = { instance: 'provider-instance', event: 'messages_update',
  data: { id: 'group-receipt-1', status: 'read', chatid: '120363000000000000@g.us' } };

it('acknowledges an explicitly disabled group without enqueueing or inline writes', async () => {
  env.WHATSAPP_EDGE_INBOX_ENABLED = 'true';
  env.WHATSAPP_EDGE_INBOX_INSTANCE_IDS = enabledId;
  groupPolicy = 'disabled';
  const result = await run(groupReceipt);
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ accepted: true });
  expect(databaseCalls.some(call => call.url.includes('/organizations'))).toBe(true);
  expect(enqueues()).toHaveLength(0);
  expect(statusWrites()).toHaveLength(0);
});

it.each(['missing', 'error'] as const)('keeps group receipt retryable when policy is %s', async policy => {
  env.WHATSAPP_EDGE_INBOX_ENABLED = 'true';
  env.WHATSAPP_EDGE_INBOX_INSTANCE_IDS = enabledId;
  groupPolicy = policy;
  const result = await run(groupReceipt);
  expect(result.status).toBe(503);
  expect(result.headers.get('Retry-After')).toBe('5');
  expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(result.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  expect(enqueues()).toHaveLength(0);
  expect(statusWrites()).toHaveLength(0);
});

it('enqueues a group receipt when the organization enables capture', async () => {
  env.WHATSAPP_EDGE_INBOX_ENABLED = 'true';
  env.WHATSAPP_EDGE_INBOX_INSTANCE_IDS = enabledId;
  groupPolicy = 'enabled';
  const result = await run(groupReceipt);
  expect(result.status).toBe(200);
  expect(enqueues()).toHaveLength(1);
  expect(enqueues()[0].body).toEqual(expect.objectContaining({ p_payload: groupReceipt }));
  expect(statusWrites()).toHaveLength(0);
});

it.each([
  { name: 'database error', response: () => json({ code: 'P0001', message: 'overflow' }, 503) },
  { name: 'invalid RPC result', response: () => json(null) },
  { name: 'network failure', response: () => Promise.reject(new Error('connection lost')) },
])('returns retryable 503 for $name without falling back to inline status writes', async ({ response }) => {
  env.WHATSAPP_EDGE_INBOX_ENABLED = 'true';
  env.WHATSAPP_EDGE_INBOX_INSTANCE_IDS = enabledId;
  enqueue = response;
  const result = await run({ instance: 'provider-instance', event: 'messages_update', data: { id: 'receipt-1', status: 'read' } });
  expect(result.status).toBe(503);
  expect(result.headers.get('Retry-After')).toBe('5');
  expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(result.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  expect(enqueues()).toHaveLength(1);
  expect(statusWrites()).toHaveLength(0);
});


it('registers the bridged Edge entrypoint but leaves the worker factory independent of Edge flags', async () => {
  env.WHATSAPP_EDGE_INBOX_ENABLED = 'true';
  env.WHATSAPP_EDGE_INBOX_INSTANCE_IDS = enabledId;
  const serve = vi.fn();
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key], toObject: () => env }, serve });
  const { whatsappWebhookHandler } = await import('../../supabase/functions/whatsapp-webhook/index.ts');
  expect(serve).toHaveBeenCalledWith(whatsappWebhookHandler);
  const payload = { instance: 'provider-instance', event: 'messages_update', data: { id: 'existing-message', status: 'sent' } };
  expect((await whatsappWebhookHandler(webhook(payload))).status).toBe(200);
  expect(enqueues()).toHaveLength(1);
  expect(statusWrites()).toHaveLength(0);
  databaseCalls = [];
  expect((await createHandler({ trustedQueuedReplay: true })(webhook(payload))).status).toBe(200);
  expect(enqueues()).toHaveLength(0);
  expect(statusWrites()).toHaveLength(1);
});

const executionReceipt = { instance: 'provider-instance', event: 'messages_update',
  data: { id: 'existing-message', status: 'failed' } };

it.each(['', 'bad-id', `${enabledId},`])('rejects invalid execution allowlist %j', value => {
  env.WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS = value || ',';
  expect(bridge).toThrow(/WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS/);
});

it('gates only the resolved database instance, independent of the legacy bridge flag', async () => {
  env.WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS = enabledId;
  env.WHATSAPP_EDGE_INBOX_ENABLED = 'true';
  env.WHATSAPP_EDGE_INBOX_INSTANCE_IDS = enabledId;
  const response = await run({ ...executionReceipt, organization_id: 'forged' }, undefined, 'url-hint');
  expect(response.status).toBe(200);
  expect(begins()).toHaveLength(1);
  expect(begins()[0].body).toEqual({ p_organization_id: organizationId, p_instance_id: enabledId,
    p_payload: { ...executionReceipt, organization_id: 'forged' }, p_path_instance_id: 'url-hint' });
  expect(enqueues()).toHaveLength(0);
  expect(statusWrites()).toHaveLength(1);
  expect(completions()).toHaveLength(1);
  expect(completions()[0].body).toEqual({ p_organization_id: organizationId, p_instance_id: enabledId, p_ticket_id: enabledId });
  databaseCalls = [];
  resolvedId = otherId;
  expect((await run(executionReceipt)).status).toBe(200);
  expect(begins()).toHaveLength(0);
});

it('acknowledges queued work without inline effects or completion', async () => {
  env.WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS = enabledId;
  beginExecution = async () => json({ mode: 'queued', event_id: otherId });
  const response = await run(executionReceipt);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ accepted: true });
  expect(statusWrites()).toHaveLength(0);
  expect(completions()).toHaveLength(0);
});

it('skips only a confirmed disabled group before beginning execution', async () => {
  env.WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS = enabledId;
  groupPolicy = 'disabled';
  expect((await run(groupReceipt)).status).toBe(200);
  expect(begins()).toHaveLength(0);
  groupPolicy = 'error';
  expect((await run(groupReceipt)).status).toBe(503);
  expect(begins()).toHaveLength(0);
});

it.each([
  { name: 'RPC error', result: () => json({ code: 'P0001', message: 'down' }, 503) },
  { name: 'network error', result: () => Promise.reject(new Error('offline')) },
  { name: 'bad mode', result: () => json({ mode: 'unknown', ticket_id: enabledId }) },
  { name: 'bad inline ID', result: () => json({ mode: 'inline', ticket_id: 'bad' }) },
  { name: 'bad queue ID', result: () => json({ mode: 'queued', event_id: 'bad' }) },
  { name: 'null', result: () => json(null) },
])('retains work and returns 503 on begin $name', async ({ result }) => {
  env.WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS = enabledId;
  beginExecution = result;
  const response = await run(executionReceipt);
  expect(response.status).toBe(503);
  expect(response.headers.get('Retry-After')).toBe('5');
  expect(statusWrites()).toHaveLength(0);
  expect(completions()).toHaveLength(0);
});

it.each(['rpc', 'network'] as const)('retains ticket when completion has %s failure', async mode => {
  env.WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS = enabledId;
  completeExecution = mode === 'rpc' ? async () => json(false)
    : async () => { throw new Error('offline'); };
  const response = await run(executionReceipt);
  expect(response.status).toBe(503);
  expect(statusWrites()).toHaveLength(1);
  expect(completions()).toHaveLength(1);
});

it('keeps ticket when actual receipt persistence rejects', async () => {
  env.WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS = enabledId;
  writeReceipt = async () => json({ code: 'P0001', message: 'write failed' }, 503);
  expect((await run(executionReceipt)).status).toBe(500);
  expect(completions()).toHaveLength(0);
});

it('keeps a ticket for malformed inline updates even when strict targets are disabled', async () => {
  env.WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS = enabledId;
  const handler = createHandler({ admitEvent: bridge(), strictUpdateTargets: false });
  const response = await handler(webhook({ instance: 'provider-instance', event: 'messages_update',
    data: { status: 'read' } }));
  expect(response.status).toBe(500);
  expect(begins()).toHaveLength(1);
  expect(statusWrites()).toHaveLength(0);
  expect(completions()).toHaveLength(0);
});

it('completes a well formed pure inline receipt without a matching message', async () => {
  env.WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS = enabledId;
  const handler = createHandler({ admitEvent: bridge(), strictUpdateTargets: false });
  const response = await handler(webhook({ instance: 'provider-instance', event: 'messages_update',
    data: { id: 'outside-crm', status: 'read' } }));
  expect(response.status).toBe(200);
  expect(begins()).toHaveLength(1);
  expect(completions()).toHaveLength(1);
});

it('retains a ticket for an invalid update when strict targets are enabled', async () => {
  env.WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS = enabledId;
  const handler = createHandler({ admitEvent: bridge(), strictUpdateTargets: true });
  const response = await handler(webhook({ instance: 'provider-instance', event: 'messages_update',
    data: { status: 'read' } }));
  expect(response.status).toBe(500);
  expect(begins()).toHaveLength(1);
  expect(statusWrites()).toHaveLength(0);
  expect(completions()).toHaveLength(0);
});

it('returns 503 when admission callback throws', async () => {
  const handler = createHandler({ admitEvent: async () => { throw new Error('database unavailable'); } });
  const response = await handler(webhook(executionReceipt));
  expect(response.status).toBe(503);
  expect(statusWrites()).toHaveLength(0);
});

it('settles after HTTP timeout only when deferred business work later succeeds', async () => {
  env.WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS = enabledId;
  let finish!: (value: Response) => void;
  writeReceipt = () => new Promise(resolve => { finish = resolve; });
  vi.useFakeTimers();
  try {
    const pending = run(executionReceipt);
    for (let i = 0; i < 30 && !finish; i++) await vi.advanceTimersByTimeAsync(0);
    expect(finish).toBeDefined();
    await vi.advanceTimersByTimeAsync(12_001);
    expect((await pending).status).toBe(500);
    expect(completions()).toHaveLength(0);
    finish(json([{ id: 'row-1' }]));
    for (let i = 0; i < 30 && completions().length === 0; i++) await Promise.resolve();
    expect(completions()).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});

it('keeps ticket when deferred business work fails after HTTP timeout', async () => {
  env.WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS = enabledId;
  let finish!: (value: Response) => void;
  writeReceipt = () => new Promise(resolve => { finish = resolve; });
  vi.useFakeTimers();
  try {
    const pending = run(executionReceipt);
    for (let i = 0; i < 30 && !finish; i++) await vi.advanceTimersByTimeAsync(0);
    expect(finish).toBeDefined();
    await vi.advanceTimersByTimeAsync(12_001);
    expect((await pending).status).toBe(500);
    finish(json({ code: 'P0001', message: 'write failed' }, 503));
    for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(0);
    expect(completions()).toHaveLength(0);
  } finally { vi.useRealTimers(); }
});
