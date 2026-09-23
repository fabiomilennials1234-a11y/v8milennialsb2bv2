// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { WhatsAppWebhookOptions } from '../../supabase/functions/whatsapp-webhook/handler.ts';

vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ logRuntime: vi.fn(async () => {}), redactSecrets: (value: unknown) => value }));
const allowedId = '10000000-0000-0000-0000-000000000001';
let resolvedId: string | null;
let dlqFails: boolean;
let requests: string[];
let makeHandler: (options?: WhatsAppWebhookOptions) => (req: Request) => Promise<Response>;
const env: Record<string, string> = {
  SUPABASE_URL: 'https://ingress-db.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  UAZAPI_WEBHOOK_SECRET: 'fixture-secret',
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

beforeAll(async () => {
  const serve = vi.fn();
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key], toObject: () => env }, serve });
  makeHandler = (await import('../../supabase/functions/whatsapp-webhook/handler.ts')).createWhatsAppWebhookHandler;
  expect(serve).not.toHaveBeenCalled();
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  resolvedId = allowedId; dlqFails = false; requests = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input); requests.push(url);
    if (url.includes('check_rate_limit')) return json({ allowed: true, remaining: 100 });
    if (url.includes('whatsapp_instance_secrets')) return json(resolvedId ? { instance_id: resolvedId, organization_id: 'org' } : null);
    if (url.includes('whatsapp_instances')) return json(resolvedId ? { id: resolvedId, organization_id: 'org', provider: 'uazapi' } : null);
    if (url.includes('whatsapp_webhook_dlq')) return dlqFails ? json({ message: 'write failed', code: '42501' }, 403) : json(null, 201);
    throw new Error('Unexpected backend request');
  }));
});
const request = (payload: unknown, secret = 'fixture-secret') => new Request(`https://ingress.test/whatsapp-webhook/${secret}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
});

it('rejects bad authentication before any database lookup', async () => {
  const handler = makeHandler({ allowInstance: id => id === allowedId });
  expect((await handler(request({ instance: allowedId }, 'wrong-secret'))).status).toBe(404);
  expect(requests).toHaveLength(0);
});

it('evaluates the resolved database instance, not forged payload admission', async () => {
  resolvedId = '20000000-0000-0000-0000-000000000002';
  const allowInstance = vi.fn(id => id === allowedId);
  const result = await makeHandler({ allowInstance })(request({ instance: allowedId, event: 'other' }));
  expect(result.status).toBe(503);
  expect(allowInstance).toHaveBeenCalledWith(resolvedId, 'org');
  expect(requests.some(url => url.includes('whatsapp_messages'))).toBe(false);
});

it('allows canonical handling after authenticated database resolution matches rollout scope', async () => {
  expect((await makeHandler({ allowInstance: id => id === allowedId })(request({ instance: 'provider-id', event: 'other' }))).status).toBe(200);
});

it.each([{}, { instance: 'unresolvable-provider-id' }])('does not ACK unresolved instance in a scoped rollout: %j', async payload => {
  resolvedId = null;
  expect((await makeHandler({ allowInstance: () => true })(request(payload))).status).toBe(503);
  expect(requests.some(url => url.includes('whatsapp_webhook_dlq'))).toBe(false);
});

it('preserves Edge DLQ durability: failed parking is 503, successful parking is 200', async () => {
  const handler = makeHandler();
  dlqFails = true;
  const failed = await handler(request({ event: 'messages' }));
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({ error: 'dlq_unavailable', reason: 'missing_instance' });
  dlqFails = false;
  expect((await handler(request({ event: 'messages' }))).status).toBe(200);
});

it('cannot enable trusted replay through external body or headers', async () => {
  const forged = new Request('https://ingress.test/whatsapp-webhook/fixture-secret', {
    method: 'POST', headers: { 'Content-Type':'application/json', 'x-trusted-queued-replay':'true', 'x-replay-source':'ingress-worker' },
    body:JSON.stringify({instance:'provider-id',event:'other',timestamp:1,trustedQueuedReplay:true,receivedAt:'2026-09-23T00:00:00Z'}),
  });
  expect((await makeHandler()(forged)).status).toBe(400);
  expect(requests).toHaveLength(0);
});

it('internal trusted replay bypasses only admission age/rate, retaining secret and tenant checks',async()=>{
  const handler=makeHandler({trustedQueuedReplay:true,allowInstance:id=>id===allowedId});
  expect((await handler(request({instance:'provider-id',event:'other',timestamp:1},'wrong-secret'))).status).toBe(404);
  expect(requests).toHaveLength(0);
  expect((await handler(request({instance:'provider-id',event:'other',timestamp:1}))).status).toBe(200);
  expect(requests.some(url=>url.includes('check_rate_limit'))).toBe(false);
  expect(requests.some(url=>url.includes('whatsapp_instances'))).toBe(true);
  resolvedId='20000000-0000-0000-0000-000000000002';
  expect((await handler(request({instance:'provider-id',event:'other',timestamp:1}))).status).toBe(503);
});

it('durable admission receives resolved tenant only after authentication and allowlist',async()=>{
  const admitEvent=vi.fn(async()=>json({error:'inbox_unavailable'},503));
  const handler=makeHandler({allowInstance:id=>id===allowedId,admitEvent});
  const payload={instance:'provider-id',event:'messages_update',organization_id:'forged-org'};
  expect((await handler(request(payload,'wrong-secret'))).status).toBe(404);
  expect(admitEvent).not.toHaveBeenCalled();
  resolvedId='20000000-0000-0000-0000-000000000002';
  expect((await handler(request(payload))).status).toBe(503);
  expect(admitEvent).not.toHaveBeenCalled();
  resolvedId=allowedId;
  const response=await handler(request(payload));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({error:'inbox_unavailable'});
  expect(admitEvent).toHaveBeenCalledWith(expect.objectContaining({instance:expect.objectContaining({id:allowedId,organization_id:'org'}),event:'messages_update'}));
  expect(requests.some(url=>url.includes('whatsapp_messages'))).toBe(false);
});
