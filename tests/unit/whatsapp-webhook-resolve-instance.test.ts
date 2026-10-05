// @vitest-environment node
/**
 * whatsapp-webhook — resolução de instância por RPC (token fora da URL).
 *
 * Antes: três GETs REST por evento, um deles `whatsapp_instance_secrets?
 * uazapi_token=eq.<TOKEN>` — a query string vai em claro para edge_logs.
 * Agora: um POST `rpc/resolve_uazapi_instance` com o token no corpo. O mesmo
 * vale para a checagem de token envenenado (`rpc/count_exhausted_uazapi_dlq_by_token`).
 *
 * Também prova que o log `uazapi_unknown_instance`/`uazapi_missing_instance`
 * não grava conteúdo cru do payload (texto, telefone, token).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const hoist = vi.hoisted(() => ({ logs: [] as Array<Record<string, unknown>> }));
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({
  logRuntime: vi.fn(async (entry: Record<string, unknown>) => { hoist.logs.push(entry); }),
  redactSecrets: (value: unknown) => value,
}));

// Valores fabricados para teste — não são credenciais reais.
const TOKEN = 'zq81tokfixture-7f3e9c1a';
// Token distinto para o caminho envenenado: o veredito do ERR-4 é cacheado por token.
const POISON_TOKEN = 'pv52ghostfixture-0b1d';
const INSTANCE_ID = '10000000-0000-0000-0000-000000000001';
const ORG_ID = '20000000-0000-0000-0000-000000000002';
const env: Record<string, string> = {
  SUPABASE_URL: 'https://resolve-db.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  UAZAPI_WEBHOOK_SECRET: 'fixture-secret',
};

type Call = { url: string; method: string; body: string };
let calls: Call[];
let rpcRow: Record<string, unknown> | null;
let poisonCount: number;
let makeHandler: (typeof import('../../supabase/functions/whatsapp-webhook/handler.ts'))['createWhatsAppWebhookHandler'];

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: (k: string) => env[k], toObject: () => env }, serve: vi.fn() });
  makeHandler = (await import('../../supabase/functions/whatsapp-webhook/handler.ts')).createWhatsAppWebhookHandler;
});
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  calls = [];
  hoist.logs.length = 0;
  rpcRow = { id: INSTANCE_ID, organization_id: ORG_ID, instance_name: 'Comercial', phone_number: '5511900000001', provider: 'uazapi', via: 'token' };
  poisonCount = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.clone().text();
    calls.push({ url: req.url, method: req.method, body });
    const url = req.url;
    if (url.includes('/rpc/check_rate_limit')) return json({ allowed: true, remaining: 100 });
    if (url.includes('/rpc/resolve_uazapi_instance')) return json(rpcRow ? [rpcRow] : []);
    if (url.includes('/rpc/count_exhausted_uazapi_dlq_by_token')) return json(poisonCount);
    if (url.includes('whatsapp_webhook_dlq')) return json(null, 201);
    throw new Error(`Unexpected backend request: ${req.method} ${url.split('?')[0]}`);
  }));
});

const post = (payload: unknown) => new Request('https://ingress.test/whatsapp-webhook/fixture-secret/messages', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
});
const resolveCalls = () => calls.filter((c) => c.url.includes('/rpc/resolve_uazapi_instance'));
const fallbackLogs = () => hoist.logs.filter((l) => l.action === 'uazapi_resolved_by_token_fallback');

describe('resolução de instância', () => {
  it('faz exatamente 1 requisição de resolução por evento, POST, sem leitura REST de secrets/instances', async () => {
    const res = await makeHandler()(post({ EventType: 'other', instanceName: 'Comercial', token: TOKEN }));
    expect(res.status).toBe(200);
    expect(resolveCalls()).toHaveLength(1);
    expect(resolveCalls()[0].method).toBe('POST');
    expect(JSON.parse(resolveCalls()[0].body)).toEqual({ p_instance_ref: null, p_token: TOKEN });
    expect(calls.some((c) => c.url.includes('whatsapp_instance_secrets'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/rest/v1/whatsapp_instances'))).toBe(false);
  });

  it('instanceName nunca vai como p_instance_ref — nome igual ao r… de outra org não sequestra o tenant', async () => {
    // Org A batizou a instância com o uazapi_instance_id de uma instância da org B.
    await makeHandler()(post({ EventType: 'other', instanceName: 'rBBB222', token: TOKEN }));
    await makeHandler()(post({ EventType: 'other', InstanceName: 'rBBB222', token: TOKEN }));
    expect(resolveCalls()).toHaveLength(2);
    for (const c of resolveCalls()) expect(JSON.parse(c.body)).toEqual({ p_instance_ref: null, p_token: TOKEN });
  });

  it('id explícito (campo de id ou path) continua indo como p_instance_ref', async () => {
    await makeHandler()(post({ EventType: 'other', instance: 'rAAA111', instanceName: 'Comercial', token: TOKEN }));
    expect(JSON.parse(resolveCalls()[0].body)).toEqual({ p_instance_ref: 'rAAA111', p_token: TOKEN });
    calls = [];
    await makeHandler()(new Request('https://ingress.test/whatsapp-webhook/fixture-secret/rPATH999/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EventType: 'other', instanceName: 'Comercial', token: TOKEN }),
    }));
    expect(JSON.parse(resolveCalls()[0].body)).toEqual({ p_instance_ref: 'rPATH999', p_token: TOKEN });
  });

  it('só instanceName, sem token → não resolve nada e cai na DLQ unknown_instance (como antes)', async () => {
    rpcRow = null;
    const res = await makeHandler()(post({ EventType: 'messages', instanceName: 'Comercial' }));
    expect(res.status).toBe(200);
    expect(resolveCalls()).toHaveLength(0);
    expect(hoist.logs.some((l) => l.action === 'uazapi_unknown_instance')).toBe(true);
  });

  it('o token nunca aparece em URL alguma — nem quando a instância não resolve (caminho ERR-4)', async () => {
    await makeHandler()(post({ EventType: 'messages', instanceName: 'Comercial', token: TOKEN }));
    rpcRow = null;
    poisonCount = 0;
    await makeHandler()(post({ EventType: 'messages', instanceName: 'Fantasma', token: TOKEN }));
    poisonCount = 99;
    await makeHandler()(post({ EventType: 'messages', token: POISON_TOKEN }));
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      for (const t of [TOKEN, POISON_TOKEN]) {
        expect(c.url).not.toContain(t);
        expect(decodeURIComponent(c.url)).not.toContain(t);
      }
    }
    const poison = calls.filter((c) => c.url.includes('/rpc/count_exhausted_uazapi_dlq_by_token'));
    expect(poison.length).toBeGreaterThan(0);
    expect(poison[0].method).toBe('POST');
    expect(JSON.parse(poison[0].body)).toEqual({ p_token: TOKEN, p_min_attempts: 5 });
    // Drop de token envenenado: log amostrado leva fingerprint, nunca prefixo do token.
    const dropped = hoist.logs.find((l) => l.action === 'uazapi_unknown_instance_dropped');
    expect(dropped).toBeDefined();
    expect((dropped!.payloadSnapshot as Record<string, unknown>).instance_ref_sha256).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(hoist.logs)).not.toContain(POISON_TOKEN.slice(0, 8));
    expect(JSON.stringify(hoist.logs)).not.toContain(TOKEN.slice(0, 8));
  });

  it('contrato preservado: a instância resolvida chega ao allowInstance e ao admitEvent', async () => {
    const allowInstance = vi.fn(() => true);
    const admitEvent = vi.fn(async () => json({ queued: true }, 202));
    const res = await makeHandler({ allowInstance, admitEvent })(post({ EventType: 'messages', token: TOKEN }));
    expect(res.status).toBe(202);
    expect(allowInstance).toHaveBeenCalledWith(INSTANCE_ID, ORG_ID);
    expect(admitEvent).toHaveBeenCalledWith(expect.objectContaining({
      instance: { id: INSTANCE_ID, organization_id: ORG_ID, instance_name: 'Comercial', phone_number: '5511900000001', provider: 'uazapi' },
    }));
  });

  it('RPC sem linha → caminho de instância desconhecida (DLQ), igual ao antes', async () => {
    rpcRow = null;
    const res = await makeHandler()(post({ EventType: 'messages', instanceName: 'X', token: TOKEN }));
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.url.includes('whatsapp_webhook_dlq') && c.method === 'POST')).toBe(true);
    expect(hoist.logs.some((l) => l.action === 'uazapi_unknown_instance')).toBe(true);
  });

  it('erro da RPC → null (não derruba a requisição), igual ao maybeSingle antigo', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(String(input), init);
      calls.push({ url: req.url, method: req.method, body: '' });
      if (req.url.includes('/rpc/check_rate_limit')) return json({ allowed: true, remaining: 100 });
      if (req.url.includes('/rpc/resolve_uazapi_instance')) return json({ message: 'boom', code: 'XX000' }, 500);
      if (req.url.includes('/rpc/count_exhausted_uazapi_dlq_by_token')) return json(0);
      if (req.url.includes('whatsapp_webhook_dlq')) return json(null, 201);
      throw new Error('unexpected');
    });
    const res = await makeHandler()(post({ EventType: 'messages', token: TOKEN }));
    expect(res.status).toBe(200);
    expect(hoist.logs.some((l) => l.action === 'uazapi_unknown_instance')).toBe(true);
  });
});

describe('log do fallback por token', () => {
  it('payload V2 normal (instanceName + token) resolve por token SEM gravar fallback — o nome não é id', async () => {
    await makeHandler()(post({ EventType: 'other', instanceName: 'Comercial', token: TOKEN }));
    expect(fallbackLogs()).toHaveLength(0);
  });

  it('id explícito no payload que não casa e token que casa → grava o fallback, sem o token', async () => {
    await makeHandler()(post({ EventType: 'other', instance: 'rDESCONHECIDO', token: TOKEN }));
    expect(fallbackLogs()).toHaveLength(1);
    expect(fallbackLogs()[0].payloadSnapshot).toEqual({
      instance_id: INSTANCE_ID, organization_id: ORG_ID, event: 'other', had_instance_id_candidate: true,
    });
    expect(JSON.stringify(hoist.logs)).not.toContain(TOKEN);
  });

  it('id explícito que casa (via=instance_id) → sem fallback', async () => {
    rpcRow = { ...rpcRow!, via: 'instance_id' };
    await makeHandler()(post({ EventType: 'other', instance: 'rAAA111', token: TOKEN }));
    expect(fallbackLogs()).toHaveLength(0);
  });
});

describe('log de evento sem instância não grava payload cru', () => {
  it('texto, telefone e token do payload não aparecem no log nem no snapshot', async () => {
    const payload = {
      EventType: 'messages',
      message: { text: 'Meu CPF é 123.456.789-00, me liga', sender: '5511987654321@s.whatsapp.net', chatid: '5511987654321@s.whatsapp.net' },
      chat: { phone: '+55 11 98765-4321', wa_name: 'Fulana de Tal' },
      owner: '5511900000001',
      Token: '',
      apiKey: TOKEN,
    };
    const res = await makeHandler()(post(payload));
    expect(res.status).toBe(200);
    const missing = hoist.logs.find((l) => l.action === 'uazapi_missing_instance');
    expect(missing).toBeDefined();
    const logged = JSON.stringify(missing);
    // 'fixture-secret' é o segredo global do webhook, que viaja no path da URL.
    for (const secret of ['Meu CPF', '123.456.789-00', '5511987654321', '98765-4321', 'Fulana', '5511900000001', TOKEN, 'fixture-secret']) {
      expect(logged).not.toContain(secret);
    }
    expect(missing!.payloadSnapshot).toEqual(expect.objectContaining({
      event: 'messages',
      keys: ['EventType', 'message', 'chat', 'owner', 'Token', 'apiKey'],
      payload_bytes: JSON.stringify(payload).length,
      url_path: '/whatsapp-webhook/<secret>/messages',
    }));
    expect(missing!.payloadSnapshot).not.toHaveProperty('raw_truncated');
  });
});
