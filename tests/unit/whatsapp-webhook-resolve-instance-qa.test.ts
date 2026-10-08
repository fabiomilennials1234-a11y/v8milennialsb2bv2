// @vitest-environment node
/**
 * QA — whatsapp-webhook resolução por RPC, com payloads no SHAPE REAL de prod
 * (chaves lidas de whatsapp_ingress_events / whatsapp_webhook_dlq em 2026-10-05):
 *   messages_update: BaseUrl, event, EventType, instanceName, owner, state, token, type
 *   messages:        BaseUrl, chat, chatSource, EventType, instanceName, message, owner, token
 *   connection:      BaseUrl, event_id, EventType, instance (OBJETO), instanceName, owner, token
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const hoist = vi.hoisted(() => ({ logs: [] as Array<Record<string, unknown>> }));
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({
  logRuntime: vi.fn(async (entry: Record<string, unknown>) => { hoist.logs.push(entry); }),
  redactSecrets: (value: unknown) => value,
}));
vi.mock('../../supabase/functions/_shared/quotes/presentation.ts', () => ({
  completeQuotePresentations: vi.fn(async () => {}), recordQuotePresentation: vi.fn(async () => {}),
}));

// Valores fabricados — não são credenciais reais.
const TOKEN_A = 'qaTokA-3c9e1f0b-fixture';
const INSTANCE_A = '10000000-0000-0000-0000-00000000000a';
const ORG_A = '20000000-0000-0000-0000-00000000000a';
const env: Record<string, string> = {
  SUPABASE_URL: 'https://qa-db.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  UAZAPI_WEBHOOK_SECRET: 'fixture-secret',
};

type Call = { url: string; method: string; body: string };
let calls: Call[];
let rpcImpl: (body: { p_instance_ref: string | null; p_token: string | null }) => unknown[];
let poisonCount: number | 'error';
let makeHandler: typeof import('../../supabase/functions/whatsapp-webhook/handler.ts').createWhatsAppWebhookHandler;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: (k: string) => env[k], toObject: () => env }, serve: vi.fn() });
  makeHandler = (await import('../../supabase/functions/whatsapp-webhook/handler.ts')).createWhatsAppWebhookHandler;
});
afterAll(() => vi.unstubAllGlobals());

// Org B tem uazapi_instance_id 'rBBB222'. Org A batizou a instância dela de 'rBBB222' (ataque B1).
const rowA = { id: INSTANCE_A, organization_id: ORG_A, instance_name: 'rBBB222', phone_number: '5511900000001', provider: 'uazapi' };
const rowB = { id: '10000000-0000-0000-0000-00000000000b', organization_id: '20000000-0000-0000-0000-00000000000b', instance_name: 'Vendas', phone_number: '5511900000002', provider: 'uazapi' };
const realRpc = ({ p_instance_ref, p_token }: { p_instance_ref: string | null; p_token: string | null }) => {
  if (p_instance_ref === 'rBBB222') return [{ ...rowB, via: 'instance_id' }];
  if (p_token === TOKEN_A) return [{ ...rowA, via: 'token' }];
  return [];
};

beforeEach(() => {
  calls = [];
  hoist.logs.length = 0;
  rpcImpl = realRpc;
  poisonCount = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.clone().text();
    calls.push({ url: req.url, method: req.method, body });
    const url = req.url;
    if (url.includes('/rpc/check_rate_limit')) return json({ allowed: true, remaining: 100 });
    if (url.includes('/rpc/resolve_uazapi_instance')) return json(rpcImpl(JSON.parse(body)));
    if (url.includes('/rpc/count_exhausted_uazapi_dlq_by_token')) {
      return poisonCount === 'error' ? json({ message: 'boom' }, 500) : json(poisonCount);
    }
    if (url.includes('whatsapp_webhook_dlq')) return json(null, 201);
    if (url.includes('/whatsapp_messages')) return json(req.method === 'GET' ? [] : [{ id: 'row-1' }]);
    return json([]);
  }));
});

const post = (payload: unknown, path = '/whatsapp-webhook/fixture-secret/messages') =>
  new Request(`https://ingress.test${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
const resolveBodies = () => calls.filter((c) => c.url.includes('/rpc/resolve_uazapi_instance')).map((c) => JSON.parse(c.body));
const noTokenInAnyUrl = (tokens: string[]) => {
  for (const c of calls) for (const t of tokens) {
    expect(c.url).not.toContain(t);
    expect(decodeURIComponent(c.url)).not.toContain(t);
  }
};
const MU = '/whatsapp-webhook/fixture-secret/messages_update';
const readReceipt = (token: string, instanceName = 'Comercial') => ({
  BaseUrl: 'https://fixture.uazapi.test', EventType: 'messages_update', instanceName, owner: '5511900000001',
  state: 'Delivered', token, type: 'ReadReceipt',
  event: {
    Chat: '5511988887777@s.whatsapp.net', chatid: '5511988887777@s.whatsapp.net', chatlid: '', IsFromMe: false, IsGroup: false,
    MessageIDs: ['3EB0FIXTUREQA01'], Sender: '5511988887777@s.whatsapp.net', sender_lid: '', sender_pn: '',
    Timestamp: '2026-10-05T17:00:00Z', Type: 'Delivered',
  },
});
const settle = () => new Promise((r) => setTimeout(r, 50));
const writes = () => calls.filter((c) => c.url.includes('/whatsapp_messages') && c.method !== 'GET');

describe('QA golden path — shape real, sem admitEvent', () => {
  it('messages_update V2: 1 RPC (p_instance_ref null, token no corpo), status gravado na instância resolvida', async () => {
    const res = await makeHandler()(post(readReceipt(TOKEN_A), MU)); await settle(); await settle();
    expect(res.status).toBe(200);
    expect(resolveBodies()).toEqual([{ p_instance_ref: null, p_token: TOKEN_A }]);
    expect(writes().length).toBeGreaterThan(0);
    expect(decodeURIComponent(writes()[0].url)).toContain(`instance_id=eq.${INSTANCE_A}`);
    expect(calls.some((c) => c.url.includes('whatsapp_webhook_dlq'))).toBe(false);
    expect(calls.some((c) => c.url.includes('whatsapp_instance_secrets'))).toBe(false);
    noTokenInAnyUrl([TOKEN_A]);
  });

  it('messages V2 (texto inbound): resolve por token, não cai na DLQ, token fora de toda URL', async () => {
    const payload = {
      BaseUrl: 'https://fixture.uazapi.test', EventType: 'messages', instanceName: 'Comercial', owner: '5511900000001', token: TOKEN_A,
      chatSource: 'updated',
      chat: { wa_chatid: '5511988887777@s.whatsapp.net', phone: '+55 11 98888-7777', wa_name: 'Cliente QA' },
      message: { messageid: '3EB0FIXTUREQA02', chatid: '5511988887777@s.whatsapp.net', fromMe: false, isGroup: false,
        messageType: 'Conversation', text: 'oi, fixture', sender: '5511988887777@s.whatsapp.net', messageTimestamp: 1791219600000 },
    };
    const res = await makeHandler()(post(payload)); await settle(); await settle();
    expect(res.status).toBeLessThan(500);
    expect(resolveBodies()).toEqual([{ p_instance_ref: null, p_token: TOKEN_A }]);
    expect(calls.some((c) => c.url.includes('whatsapp_webhook_dlq'))).toBe(false);
    expect(hoist.logs.some((l) => l.action === 'uazapi_unknown_instance' || l.action === 'uazapi_missing_instance')).toBe(false);
    const msgWrite = writes().find((w) => w.method === 'POST');
    expect(msgWrite, 'upsert de whatsapp_messages').toBeDefined();
    expect(msgWrite!.body).toContain(ORG_A);
    expect(msgWrite!.body).toContain(INSTANCE_A);
    noTokenInAnyUrl([TOKEN_A]);
  });

  it('connection V2: `instance` é OBJETO em prod → não vira id; resolve por token', async () => {
    const payload = {
      BaseUrl: 'https://fixture.uazapi.test', EventType: 'connection', event_id: 'evt-qa', owner: '5511900000001', token: TOKEN_A,
      instanceName: 'Comercial', instance: { name: 'Comercial', status: 'connected', lastDisconnect: '', lastDisconnectReason: '' },
    };
    await makeHandler()(post(payload, '/whatsapp-webhook/fixture-secret/connection')); await settle();
    expect(resolveBodies()).toEqual([{ p_instance_ref: null, p_token: TOKEN_A }]);
    noTokenInAnyUrl([TOKEN_A]);
  });
});

describe('QA ataque B1 — nome = uazapi_instance_id de outra org', () => {
  it('evento da org A com instanceName "rBBB222" resolve para A pelo token, nunca para B', async () => {
    await makeHandler()(post(readReceipt(TOKEN_A, 'rBBB222'), MU)); await settle();
    expect(resolveBodies()).toEqual([{ p_instance_ref: null, p_token: TOKEN_A }]);
    expect(writes().length).toBeGreaterThan(0);
    for (const w of writes()) expect(decodeURIComponent(w.url) + w.body).not.toContain(rowB.id);
    expect(decodeURIComponent(writes()[0].url)).toContain(INSTANCE_A);
  });

  it('id explícito no payload tem precedência sobre o token (contrato id > token)', async () => {
    await makeHandler()(post({ ...readReceipt(TOKEN_A), instance_id: 'rBBB222' }, MU)); await settle();
    expect(resolveBodies()).toEqual([{ p_instance_ref: 'rBBB222', p_token: TOKEN_A }]);
    expect(decodeURIComponent(writes()[0].url)).toContain(rowB.id);
  });

  it('id explícito no PATH tem precedência sobre o token', async () => {
    await makeHandler()(post(readReceipt(TOKEN_A), '/whatsapp-webhook/fixture-secret/rBBB222/messages_update')); await settle();
    expect(resolveBodies()).toEqual([{ p_instance_ref: 'rBBB222', p_token: TOKEN_A }]);
  });
});

describe('QA não resolve → DLQ unknown_instance', () => {
  it('token inexistente → DLQ unknown_instance, 1 RPC, nada em whatsapp_messages', async () => {
    const ghost = 'qaGhost-77aa-fixture';
    const res = await makeHandler()(post(readReceipt(ghost), MU)); await settle(); await settle();
    expect(res.status).toBe(200);
    expect(resolveBodies()).toHaveLength(1);
    expect(calls.some((c) => c.url.includes('whatsapp_webhook_dlq') && c.method === 'POST')).toBe(true);
    expect(hoist.logs.some((l) => l.action === 'uazapi_unknown_instance')).toBe(true);
    expect(calls.some((c) => c.url.includes('/whatsapp_messages'))).toBe(false);
    noTokenInAnyUrl([ghost]);
  });

  it('token ambíguo (RPC vazia, paridade maybeSingle) → DLQ, nenhum tenant escolhido', async () => {
    rpcImpl = () => [];
    await makeHandler()(post(readReceipt('qaAmbig-11bb-fixture'), MU)); await settle();
    expect(calls.some((c) => c.url.includes('whatsapp_webhook_dlq') && c.method === 'POST')).toBe(true);
    expect(calls.some((c) => c.url.includes('/whatsapp_messages'))).toBe(false);
  });

  it('sem token e sem id (e sem nome) → missing_instance na DLQ, ZERO RPC', async () => {
    await makeHandler()(post({ EventType: 'messages_update', owner: '5511900000001', type: 'ReadReceipt' })); await settle();
    expect(resolveBodies()).toHaveLength(0);
    expect(calls.some((c) => c.url.includes('/rpc/count_exhausted_uazapi_dlq_by_token'))).toBe(false);
    expect(calls.some((c) => c.url.includes('whatsapp_webhook_dlq') && c.method === 'POST')).toBe(true);
  });
});

describe('QA ERR-4 limiar', () => {
  it.each([
    [49, false],
    [50, true],
  ])('count=%i → dropado=%s (>= 50 linhas, attempts >= 5)', async (count, dropped) => {
    poisonCount = count;
    const tok = `qaPoison-${count}-fixture`;
    await makeHandler()(post(readReceipt(tok, 'Fantasma'), MU)); await settle();
    const countCall = calls.find((c) => c.url.includes('/rpc/count_exhausted_uazapi_dlq_by_token'))!;
    expect(countCall.method).toBe('POST');
    expect(JSON.parse(countCall.body)).toEqual({ p_token: tok, p_min_attempts: 5 });
    expect(calls.some((c) => c.url.includes('whatsapp_webhook_dlq') && c.method === 'POST')).toBe(!dropped);
    noTokenInAnyUrl([tok]);
  });

  it('erro da RPC de contagem → fail-open (DLQ, não dropa)', async () => {
    poisonCount = 'error';
    await makeHandler()(post(readReceipt('qaPoison-err-fixture', 'Fantasma'), MU)); await settle();
    expect(calls.some((c) => c.url.includes('whatsapp_webhook_dlq') && c.method === 'POST')).toBe(true);
  });
});
