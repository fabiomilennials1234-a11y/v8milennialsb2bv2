// @vitest-environment node
/**
 * whatsapp-dlq-replay — resolução por RPC (token fora da URL) e nome ≠ id.
 *
 * Antes: GETs REST `whatsapp_instance_secrets?uazapi_instance_id=eq.<ref>` e
 * `?uazapi_token=eq.<TOKEN>` (token em claro no edge_logs), e `instanceName`
 * (nome escolhido pelo cliente) era candidato a id — uma org podia batizar a
 * instância com o `r…` de outra e sequestrar o replay.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ logRuntime: vi.fn(async () => {}), redactSecrets: (v: unknown) => v }));

// Valores fabricados para teste — não são credenciais reais.
const TOKEN = 'dq73tokfixture-55aa';
const SECRET = 'fixture-webhook-secret';
const RESOLVED = '10000000-0000-0000-0000-000000000001';
const env: Record<string, string> = {
  SUPABASE_URL: 'https://replay-db.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service', CRON_SECRET: 'fixture-cron',
};

type Call = { url: string; method: string; body: string };
let calls: Call[];
let dlqRows: Array<Record<string, unknown>>;
let rpcRow: Record<string, unknown> | null;
let handler: (req: Request) => Promise<Response>;
let mod: typeof import('../../supabase/functions/whatsapp-dlq-replay/index.ts');

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: { get: (k: string) => env[k], toObject: () => env },
    serve: (h: typeof handler) => { handler = h; },
  });
  mod = await import('../../supabase/functions/whatsapp-dlq-replay/index.ts');
});
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  calls = [];
  rpcRow = { id: RESOLVED, organization_id: 'org', via: 'token' };
  dlqRows = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.clone().text();
    calls.push({ url: req.url, method: req.method, body });
    const url = req.url;
    if (url.includes('/rpc/resolve_uazapi_instance')) return json(rpcRow ? [rpcRow] : []);
    if (url.includes('/rest/v1/whatsapp_webhook_dlq') && req.method === 'GET') return json(dlqRows);
    if (url.includes('/rest/v1/whatsapp_webhook_dlq') && req.method === 'PATCH') return json(null, 204);
    if (url.includes('/functions/v1/whatsapp-webhook/')) return json({ ok: true });
    throw new Error(`Unexpected request: ${req.method} ${url.split('?')[0]}`);
  }));
});

const run = () => handler(new Request('https://edge/whatsapp-dlq-replay', { method: 'POST', headers: { 'x-cron-secret': 'fixture-cron' } }));
const resolveCalls = () => calls.filter((c) => c.url.includes('/rpc/resolve_uazapi_instance'));
const row = (payload: Record<string, unknown>, url_path = `/functions/v1/whatsapp-webhook/${SECRET}/messages`) =>
  ({ id: crypto.randomUUID(), source_ip: null, url_path, event: 'messages', reason: 'unknown_instance', payload, attempts: 0 });

describe('pickInstanceCandidates', () => {
  it('instanceName / InstanceName nunca viram id', () => {
    expect(mod.pickInstanceCandidates({ instanceName: 'rBBB222', token: TOKEN })).toEqual({ instanceId: null, token: TOKEN });
    expect(mod.pickInstanceCandidates({ InstanceName: 'rBBB222' })).toEqual({ instanceId: null, token: null });
  });
  it('campos de id explícitos continuam valendo', () => {
    expect(mod.pickInstanceCandidates({ instance: 'rAAA111', instanceName: 'X' }).instanceId).toBe('rAAA111');
    expect(mod.pickInstanceCandidates({ InstanceID: ' rC ' }).instanceId).toBe('rC');
  });
});

describe('replay', () => {
  it('resolve com 1 RPC POST por linha; token nunca em URL; nome não vai como p_instance_ref', async () => {
    dlqRows = [row({ instanceName: 'rBBB222', token: TOKEN, EventType: 'messages' })];
    const res = await run();
    expect(await res.json()).toEqual(expect.objectContaining({ total: 1, resolved: 1 }));
    expect(resolveCalls()).toHaveLength(1);
    expect(resolveCalls()[0].method).toBe('POST');
    expect(JSON.parse(resolveCalls()[0].body)).toEqual({ p_instance_ref: null, p_token: TOKEN });
    expect(calls.some((c) => c.url.includes('whatsapp_instance_secrets'))).toBe(false);
    for (const c of calls) {
      expect(c.url).not.toContain(TOKEN);
      expect(decodeURIComponent(c.url)).not.toContain(TOKEN);
    }
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(JSON.parse(patch!.body)).toEqual(expect.objectContaining({ resolved_instance_id: RESOLVED }));
  });

  it('id explícito no payload vence o path; path vale quando o payload não tem id', async () => {
    dlqRows = [
      row({ instance: 'rAAA111', token: TOKEN }, `/functions/v1/whatsapp-webhook/${SECRET}/rPATH/messages`),
      row({ token: TOKEN }, `/functions/v1/whatsapp-webhook/${SECRET}/rPATH/messages`),
    ];
    await run();
    expect(resolveCalls().map((c) => JSON.parse(c.body).p_instance_ref)).toEqual(['rAAA111', 'rPATH']);
  });

  it('sem id nem token → nenhuma RPC; RPC sem linha → instance_resolution_failed', async () => {
    dlqRows = [row({ instanceName: 'Comercial' })];
    await run();
    expect(resolveCalls()).toHaveLength(0);
    rpcRow = null;
    calls = [];
    dlqRows = [row({ token: TOKEN })];
    await run();
    expect(resolveCalls()).toHaveLength(1);
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(JSON.parse(patch!.body)).toEqual(expect.objectContaining({ last_error: 'instance_resolution_failed', attempts: 1 }));
  });
});
