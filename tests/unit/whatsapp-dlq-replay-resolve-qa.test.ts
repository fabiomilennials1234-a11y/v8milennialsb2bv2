// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ logRuntime: vi.fn(async () => {}), redactSecrets: (v: unknown) => v }));
const TOK = 'qaDlqTok-9f9f-fixture';
const env: Record<string, string> = { SUPABASE_URL: 'https://qa-replay.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service', CRON_SECRET: 'fixture-cron' };
let calls: Array<{ url: string; method: string; body: string }>;
let rows: Array<Record<string, unknown>>;
let handler: (r: Request) => Promise<Response>;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: (k: string) => env[k], toObject: () => env }, serve: (h: typeof handler) => { handler = h; } });
  await import('../../supabase/functions/whatsapp-dlq-replay/index.ts');
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.clone().text();
    calls.push({ url: req.url, method: req.method, body });
    if (req.url.includes('/rpc/resolve_uazapi_instance')) {
      const b = JSON.parse(body);
      if (b.p_instance_ref === 'rAAA111') return json([{ id: 'inst-by-id', organization_id: 'o', via: 'instance_id' }]);
      if (b.p_token === TOK) return json([{ id: 'inst-by-token', organization_id: 'o', via: 'token' }]);
      return json([]);
    }
    if (req.url.includes('/rest/v1/whatsapp_webhook_dlq') && req.method === 'GET') return json(rows);
    if (req.url.includes('/rest/v1/whatsapp_webhook_dlq') && req.method === 'PATCH') return json(null, 204);
    if (req.url.includes('/functions/v1/whatsapp-webhook/')) return json({ ok: true });
    throw new Error('unexpected ' + req.method + ' ' + req.url.split('?')[0]);
  }));
});
const row = (id: string, payload: Record<string, unknown>) => ({ id, source_ip: null, url_path: '/functions/v1/whatsapp-webhook/fixture-wh-secret/messages', event: 'messages', reason: 'unknown_instance', payload, attempts: 0 });

it('lote misto (shape real): id explícito, só token, só instanceName, token desconhecido → 1 RPC por linha resolvível, token nunca em URL', async () => {
  rows = [
    row('r1', { instance_id: 'rAAA111', token: TOK, instanceName: 'X', EventType: 'messages' }),
    row('r2', { BaseUrl: 'b', EventType: 'messages', instanceName: 'rAAA111', owner: '55', token: TOK, chat: {}, message: {} }),
    row('r3', { BaseUrl: 'b', EventType: 'messages', instanceName: 'rAAA111', owner: '55', chat: {}, message: {} }),
    row('r4', { BaseUrl: 'b', EventType: 'messages', instanceName: 'Y', token: 'qaUnknown-0000-fixture' }),
  ];
  const res = await handler(new Request('https://edge/whatsapp-dlq-replay', { method: 'POST', headers: { 'x-cron-secret': 'fixture-cron' } }));
  const summary = await res.json();
  const rpc = calls.filter((c) => c.url.includes('/rpc/resolve_uazapi_instance')).map((c) => JSON.parse(c.body));
  expect(rpc).toEqual([
    { p_instance_ref: 'rAAA111', p_token: TOK },
    { p_instance_ref: null, p_token: TOK },
    { p_instance_ref: null, p_token: 'qaUnknown-0000-fixture' },
  ]);
  const patches = calls.filter((c) => c.method === 'PATCH').map((c) => ({ id: new URL(c.url).searchParams.get('id'), body: JSON.parse(c.body) }));
  expect(patches.find((p) => p.id === 'eq.r1')!.body.resolved_instance_id).toBe('inst-by-id');
  expect(patches.find((p) => p.id === 'eq.r2')!.body.resolved_instance_id).toBe('inst-by-token');
  expect(patches.find((p) => p.id === 'eq.r3')!.body.last_error).toBe('instance_resolution_failed');
  expect(patches.find((p) => p.id === 'eq.r4')!.body.last_error).toBe('instance_resolution_failed');
  expect(summary).toEqual(expect.objectContaining({ total: 4, resolved: 2 }));
  for (const c of calls) {
    expect(decodeURIComponent(c.url)).not.toContain(TOK);
    expect(decodeURIComponent(c.url)).not.toContain('qaUnknown-0000-fixture');
  }
  console.log('SUMMARY', JSON.stringify(summary));
});
