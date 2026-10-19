// @vitest-environment node
/**
 * whatsapp-webhook — F5a: menos idas ao PostgREST por evento Uazapi.
 *
 * Dirige o handler HTTP real com o supabase-js real; o único dublê é o `fetch`
 * (o backend), que registra cada requisição. Assim a contagem de chamadas é a
 * que o pool do PostgREST veria em produção.
 *
 *   UAZAPI_INGEST_RPC_ORGS vazio → sequência antiga EXATA (ingress, upsert,
 *     select, receive), menos o SELECT redundante do triggerReactions (agora
 *     usa persisted.row_id nos dois caminhos).
 *   org na flag → 1 RPC `ingest_uazapi_message` (mensagem) /
 *     `apply_uazapi_receipt` (recibo), com os mesmos erros, DLQ e logs.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const hoist = vi.hoisted(() => ({ logs: [] as Array<Record<string, unknown>> }));
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({
  logRuntime: vi.fn(async (entry: Record<string, unknown>) => { hoist.logs.push(entry); }),
  redactSecrets: (value: unknown) => value,
}));

// Valores fabricados para teste — não são credenciais reais.
const TOKEN = 'f5afixturetoken-91c2';
const INSTANCE_ID = '10000000-0000-0000-0000-0000000000f5';
const ORG_ID = '20000000-0000-0000-0000-0000000000f5';
const OTHER_ORG = '20000000-0000-0000-0000-0000000000aa';
const ROW_ID = '30000000-0000-0000-0000-0000000000f5';
const env: Record<string, string> = {
  SUPABASE_URL: 'https://f5a-db.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  UAZAPI_WEBHOOK_SECRET: 'fixture-secret', COPILOT_QUEUE_ENABLED_ORGS: ORG_ID,
};

type Call = { op: string; body: unknown };
let calls: Call[];
// Respostas do backend, sobrescritas por teste (spread sobre o default).
type Backend = {
  ingest: { status: number; body: unknown };
  receipt: { status: number; body: unknown };
  dlq: number;
  receiptPatch: unknown[];
  receiptLookup: unknown[];
};
const defaultBackend = (): Backend => ({
  ingest: { status: 200, body: { status: 'persisted', organization_id: ORG_ID, row_id: ROW_ID, inserted: true, button_reply_recognized: false, echo_status_updated: false } },
  receipt: { status: 200, body: { changed_count: 1, has_outgoing: true } },
  dlq: 201,
  receiptPatch: [{ id: ROW_ID }],
  receiptLookup: [],
});
let backend: Backend;
let makeHandler: (typeof import('../../supabase/functions/whatsapp-webhook/handler.ts'))['createWhatsAppWebhookHandler'];

const json = (data: unknown, status = 200) =>
  new Response(data === undefined ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: (k: string) => env[k], toObject: () => env }, serve: vi.fn() });
  makeHandler = (await import('../../supabase/functions/whatsapp-webhook/handler.ts')).createWhatsAppWebhookHandler;
});
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  calls = [];
  hoist.logs.length = 0;
  backend = defaultBackend();
  delete env.UAZAPI_INGEST_RPC_ORGS;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const path = url.pathname.replace(/^\/rest\/v1\//, '').replace(/^\/functions\/v1\//, 'fn/');
    const op = `${method} ${path}`;
    const raw = typeof init?.body === 'string' ? init.body : '';
    calls.push({ op, body: raw ? JSON.parse(raw) : null });
    switch (op) {
      case 'POST rpc/check_rate_limit': return json({ allowed: true, remaining: 100 });
      case 'POST rpc/resolve_uazapi_instance':
        return json([{ id: INSTANCE_ID, organization_id: ORG_ID, instance_name: 'Comercial', phone_number: '5511900000001', provider: 'uazapi', via: 'token' }]);
      case 'POST rpc/register_workflow_button_ingress': return json({ recognized: false });
      case 'POST rpc/receive_workflow_button_reply': return json({ recognized: false, resolved: false });
      case 'POST rpc/resolve_wait_response_by_phone': return json(null);
      case 'POST rpc/ingest_uazapi_message': return json(backend.ingest.body, backend.ingest.status);
      case 'POST rpc/apply_uazapi_receipt': return json(backend.receipt.body, backend.receipt.status);
      case 'POST whatsapp_messages': return json(undefined, 201);
      case 'PATCH whatsapp_messages': return json(backend.receiptPatch);
      case 'GET whatsapp_messages':
        return json(url.searchParams.get('select') === 'id' ? [{ id: ROW_ID }] : backend.receiptLookup);
      case 'GET organizations': return json([{ capture_groups: true }]);
      case 'POST copilot_message_queue': return json(undefined, 201);
      case 'POST whatsapp_webhook_dlq':
        return backend.dlq < 300 ? json(undefined, backend.dlq) : json({ message: 'dlq down', code: 'XX000' }, backend.dlq);
      default: throw new Error(`Unexpected backend request: ${op}`);
    }
  }));
});

const post = (payload: unknown) => new Request('https://ingress.test/whatsapp-webhook/fixture-secret', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
});
const messageEvent = (over: Record<string, unknown> = {}) => ({
  EventType: 'messages', token: TOKEN,
  message: {
    id: 'MSG-1', chatid: '5511999887766@s.whatsapp.net', fromMe: false, type: 'text',
    text: 'quero comprar', messageTimestamp: Date.now(), senderName: 'Lead', ...over,
  },
});
const receiptEvent = (over: Record<string, unknown> = {}) => ({
  EventType: 'messages_update', token: TOKEN, data: { id: 'OUT-1', status: 'delivered', ...over },
});
// Só o trabalho do evento: rate limit e resolução de tenant são iguais nos dois caminhos.
const business = () => calls.map((c) => c.op)
  .filter((op) => op !== 'POST rpc/check_rate_limit' && op !== 'POST rpc/resolve_uazapi_instance');
// resolve_wait_response_by_phone é fire-and-forget: a ordem relativa não é contrato.
const WAIT = 'POST rpc/resolve_wait_response_by_phone';
const awaited = () => business().filter((op) => op !== WAIT);
const waitCalls = () => business().filter((op) => op === WAIT).length;
const bodyOf = (op: string) => calls.find((c) => c.op === op)?.body as Record<string, unknown>;
const run = async (payload: unknown) => makeHandler()(post(payload));

describe('flag vazia — caminho antigo intacto', () => {
  it('incoming 1:1: ingress → upsert → select → receive → reações (sem SELECT redundante)', async () => {
    const res = await run(messageEvent());
    expect(res.status).toBe(200);
    expect(awaited()).toEqual([
      'POST rpc/register_workflow_button_ingress',
      'POST whatsapp_messages',
      'GET whatsapp_messages',
      'POST rpc/receive_workflow_button_reply',
      'POST copilot_message_queue',
    ]);
    expect(waitCalls()).toBe(1);
    expect(bodyOf('POST copilot_message_queue')).toMatchObject({ message_id: ROW_ID, organization_id: ORG_ID });
  });

  it('eco outgoing: ingress → upsert → update de status → select', async () => {
    await run(messageEvent({ fromMe: true, status: 'delivered' }));
    expect(business()).toEqual([
      'POST rpc/register_workflow_button_ingress',
      'POST whatsapp_messages',
      'PATCH whatsapp_messages',
      'GET whatsapp_messages',
    ]);
  });

  it('grupo: ingress → capture_groups → upsert → select', async () => {
    await run(messageEvent({ chatid: '120363001234567890@g.us', isGroup: true }));
    expect(business()).toEqual([
      'POST rpc/register_workflow_button_ingress',
      'GET organizations',
      'POST whatsapp_messages',
      'GET whatsapp_messages',
    ]);
  });

  it('recibo puro sem linha alterada: update → lookup de fallback', async () => {
    backend = { ...backend, receiptPatch: [], receiptLookup: [] };
    const res = await run(receiptEvent());
    expect(res.status).toBe(200);
    expect(business()).toEqual(['PATCH whatsapp_messages', 'GET whatsapp_messages']);
    expect(hoist.logs.some((l) => l.action === 'uazapi_receipt_unmatched')).toBe(true);
  });

  it('flag de OUTRA org não liga o caminho novo', async () => {
    env.UAZAPI_INGEST_RPC_ORGS = OTHER_ORG;
    await run(messageEvent());
    expect(business()).not.toContain('POST rpc/ingest_uazapi_message');
    expect(business()[0]).toBe('POST rpc/register_workflow_button_ingress');
  });
});

describe('flag ligada — 1 RPC por evento', () => {
  beforeEach(() => { env.UAZAPI_INGEST_RPC_ORGS = ` ${OTHER_ORG}, ${ORG_ID} `; });

  it('incoming 1:1: só ingest_uazapi_message + reações; fila recebe o row_id da RPC', async () => {
    const res = await run(messageEvent());
    expect(res.status).toBe(200);
    expect(awaited()).toEqual([
      'POST rpc/ingest_uazapi_message',
      'POST copilot_message_queue',
    ]);
    expect(waitCalls()).toBe(1);
    const params = bodyOf('POST rpc/ingest_uazapi_message');
    expect(params.p_instance_id).toBe(INSTANCE_ID);
    expect(params.p_source).toBe('webhook');
    expect(params.p_echo_prior_statuses).toEqual([]);
    expect(params.p_payload).toMatchObject({ id: 'MSG-1' });
    expect(params.p_message).toMatchObject({
      organization_id: ORG_ID, instance_id: INSTANCE_ID, message_id: 'MSG-1',
      direction: 'incoming', is_group: false, received_via: 'webhook', status: 'received',
    });
    expect(bodyOf('POST copilot_message_queue')).toMatchObject({ message_id: ROW_ID });
  });

  it('"*" liga para qualquer org', async () => {
    env.UAZAPI_INGEST_RPC_ORGS = '*';
    await run(messageEvent());
    expect(business()[0]).toBe('POST rpc/ingest_uazapi_message');
  });

  it('eco outgoing: 1 RPC com os status anteriores do eco', async () => {
    backend = { ...backend, ingest: { status: 200, body: { ...defaultBackend().ingest.body as object, echo_status_updated: true } } };
    const res = await run(messageEvent({ fromMe: true, status: 'delivered' }));
    expect(res.status).toBe(200);
    expect(business()).toEqual(['POST rpc/ingest_uazapi_message']);
    expect(bodyOf('POST rpc/ingest_uazapi_message').p_echo_prior_statuses).toEqual(['pending', 'sent']);
  });

  it('grupo: 1 RPC, sem reações', async () => {
    await run(messageEvent({ chatid: '120363001234567890@g.us', isGroup: true }));
    expect(business()).toEqual(['POST rpc/ingest_uazapi_message']);
    expect(hoist.logs.some((l) => l.action === 'uazapi_group_message_captured')).toBe(true);
  });

  it('group_skipped: log de opt-out, sem reações', async () => {
    backend = { ...backend, ingest: { status: 200, body: { status: 'group_skipped', organization_id: ORG_ID } } };
    const res = await run(messageEvent({ chatid: '120363001234567890@g.us', isGroup: true }));
    expect(res.status).toBe(200);
    expect(business()).toEqual(['POST rpc/ingest_uazapi_message']);
    expect(hoist.logs.find((l) => l.action === 'uazapi_group_message_skipped')).toBeDefined();
  });

  it('erro da RPC (nada gravado) → 503 question_buttons_ingress_unavailable', async () => {
    backend = { ...backend, ingest: { status: 409, body: { code: 'PT409', message: 'uazapi_ingest_conflict' } } };
    const res = await run(messageEvent());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'question_buttons_ingress_unavailable' });
    expect(business()).toEqual(['POST rpc/ingest_uazapi_message']);
  });

  it('upsert_failed → DLQ com o payload normalizado e 200', async () => {
    backend = { ...backend, ingest: { status: 200, body: { status: 'upsert_failed', organization_id: ORG_ID, sqlstate: '23502', error_message: 'null value' } } };
    const res = await run(messageEvent());
    expect(res.status).toBe(200);
    expect(business()).toEqual(['POST rpc/ingest_uazapi_message', 'POST whatsapp_webhook_dlq']);
    expect(bodyOf('POST whatsapp_webhook_dlq')).toMatchObject({ reason: 'upsert_failed', resolved_instance_id: INSTANCE_ID });
    expect(hoist.logs.find((l) => l.action === 'uazapi_messages_upsert_error')).toBeDefined();
  });

  it('upsert_failed + DLQ falhou → 500 (message_lost, provedor reentrega)', async () => {
    backend = { ...backend, dlq: 500, ingest: { status: 200, body: { status: 'upsert_failed', organization_id: ORG_ID } } };
    const res = await run(messageEvent());
    expect(res.status).toBe(500);
    const err = hoist.logs.find((l) => l.action === 'uazapi_process_error');
    expect(String((err?.payloadSnapshot as Record<string, unknown>).error)).toMatch(/^message_lost/);
  });

  it.each([
    ['button_reply_failed', 'question_button_reply_persistence_failed'],
    ['echo_status_failed', 'message_echo_status_update_failed'],
    ['algo_novo', 'uazapi_ingest_unexpected_result'],
  ])('%s → 500 com o mesmo erro do caminho antigo, sem reações', async (status, error) => {
    backend = { ...backend, ingest: { status: 200, body: { status, organization_id: ORG_ID, row_id: ROW_ID } } };
    const res = await run(messageEvent());
    expect(res.status).toBe(500);
    expect(business()).toEqual(['POST rpc/ingest_uazapi_message']);
    const err = hoist.logs.find((l) => l.action === 'uazapi_process_error');
    expect((err?.payloadSnapshot as Record<string, unknown>).error).toBe(error);
  });

  it('missing_row → 200 sem reações (como o select vazio antigo)', async () => {
    backend = { ...backend, ingest: { status: 200, body: { status: 'missing_row', organization_id: ORG_ID } } };
    const res = await run(messageEvent());
    expect(res.status).toBe(200);
    expect(business()).toEqual(['POST rpc/ingest_uazapi_message']);
  });

  it('sem message_id → p_message null e log uazapi_missing_message_id', async () => {
    backend = { ...backend, ingest: { status: 200, body: { status: 'no_message_id', organization_id: ORG_ID } } };
    await run(messageEvent({ id: undefined, messageid: undefined }));
    expect(bodyOf('POST rpc/ingest_uazapi_message').p_message).toBeNull();
    expect(hoist.logs.find((l) => l.action === 'uazapi_missing_message_id')).toBeDefined();
  });

  it('recibo puro: 1 RPC apply_uazapi_receipt com predecessores', async () => {
    const res = await run(receiptEvent());
    expect(res.status).toBe(200);
    expect(business()).toEqual(['POST rpc/apply_uazapi_receipt']);
    const params = bodyOf('POST rpc/apply_uazapi_receipt');
    expect(params).toMatchObject({ p_instance_id: INSTANCE_ID, p_status: 'delivered', p_predecessors: ['pending', 'sent', 'failed'] });
    expect(params.p_message_ids).toContain('OUT-1');
    expect(hoist.logs.some((l) => l.action === 'uazapi_receipt_unmatched')).toBe(false);
  });

  it('recibo sem alvo outgoing → mesmo log uazapi_receipt_unmatched', async () => {
    backend = { ...backend, receipt: { status: 200, body: { changed_count: 0, has_outgoing: false } } };
    await run(receiptEvent());
    expect(hoist.logs.find((l) => l.action === 'uazapi_receipt_unmatched')).toBeDefined();
  });

  it('recibo atrasado (outgoing existe, nada mudou) → sem log de unmatched', async () => {
    backend = { ...backend, receipt: { status: 200, body: { changed_count: 0, has_outgoing: true } } };
    await run(receiptEvent());
    expect(hoist.logs.some((l) => l.action === 'uazapi_receipt_unmatched')).toBe(false);
  });

  it('erro da RPC de recibo → 500 (Receipt persistence failed)', async () => {
    backend = { ...backend, receipt: { status: 404, body: { code: 'PT404', message: 'uazapi_instance_not_found' } } };
    const res = await run(receiptEvent());
    expect(res.status).toBe(500);
    const err = hoist.logs.find((l) => l.action === 'uazapi_process_error');
    expect((err?.payloadSnapshot as Record<string, unknown>).error).toBe('Receipt persistence failed');
  });
});
