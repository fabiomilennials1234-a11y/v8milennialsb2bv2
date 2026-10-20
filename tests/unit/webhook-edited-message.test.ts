// @vitest-environment node
/**
 * whatsapp-webhook — edição de mensagem (Chamado 4b8d5fd1).
 *
 * A Uazapi avisa a edição como evento `messages` com id PRÓPRIO e `edited` =
 * id (nu) da mensagem original. Antes, o handler gravava isso como mensagem
 * nova: balão duplicado no chat, original com o texto antigo e, se a edição
 * fosse do cliente, copilot e wait-response disparados por uma "mensagem" que
 * não existe.
 *
 * Mesma técnica de uazapi-ingest-rpc-edge.test.ts: handler HTTP real,
 * supabase-js real, só o `fetch` (backend) é dublê — a sequência de requisições
 * é a que o PostgREST veria. Cada cenário roda com a flag
 * UAZAPI_INGEST_RPC_ORGS desligada e ligada para a org.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const hoist = vi.hoisted(() => ({ logs: [] as Array<Record<string, unknown>> }));
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({
  logRuntime: vi.fn(async (entry: Record<string, unknown>) => { hoist.logs.push(entry); }),
  redactSecrets: (value: unknown) => value,
}));

// Valores fabricados para teste — não são credenciais reais.
const TOKEN = 'editfixturetoken-4b8d';
const INSTANCE_ID = '10000000-0000-0000-0000-0000000004b8';
const ORG_ID = '20000000-0000-0000-0000-0000000004b8';
const OWNER = '5511900000004';
const ORIGINAL_ROW = '30000000-0000-0000-0000-00000000a001';
const EDIT_ROW = '30000000-0000-0000-0000-00000000a002';
const env: Record<string, string> = {
  SUPABASE_URL: 'https://edit-db.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  UAZAPI_WEBHOOK_SECRET: 'fixture-secret', COPILOT_QUEUE_ENABLED_ORGS: ORG_ID,
};

type Call = { op: string; url: URL; body: unknown };
let calls: Call[];
type Backend = {
  original: unknown[];
  lookupStatus: number;
  patchStatus: number;
  captureGroups: boolean;
};
let backend: Backend;
let makeHandler: (typeof import('../../supabase/functions/whatsapp-webhook/handler.ts'))['createWhatsAppWebhookHandler'];

const json = (data: unknown, status = 200) =>
  new Response(data === undefined ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const pgError = (status: number) => json({ code: 'XX000', message: 'backend down' }, status);

beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: (k: string) => env[k], toObject: () => env }, serve: vi.fn() });
  makeHandler = (await import('../../supabase/functions/whatsapp-webhook/handler.ts')).createWhatsAppWebhookHandler;
});
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  calls = [];
  hoist.logs.length = 0;
  backend = { original: [{ id: ORIGINAL_ROW }], lookupStatus: 200, patchStatus: 204, captureGroups: true };
  delete env.UAZAPI_INGEST_RPC_ORGS;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const path = url.pathname.replace(/^\/rest\/v1\//, '').replace(/^\/functions\/v1\//, 'fn/');
    const op = `${method} ${path}`;
    const raw = typeof init?.body === 'string' ? init.body : '';
    calls.push({ op, url, body: raw ? JSON.parse(raw) : null });
    switch (op) {
      case 'POST rpc/check_rate_limit': return json({ allowed: true, remaining: 100 });
      case 'POST rpc/resolve_uazapi_instance':
        return json([{ id: INSTANCE_ID, organization_id: ORG_ID, instance_name: 'Comercial', phone_number: OWNER, provider: 'uazapi', via: 'token' }]);
      case 'POST rpc/register_workflow_button_ingress': return json({ recognized: false });
      case 'POST rpc/receive_workflow_button_reply': return json({ recognized: false, resolved: false });
      case 'POST rpc/resolve_wait_response_by_phone': return json(null);
      case 'POST rpc/ingest_uazapi_message':
        return json({ status: 'persisted', organization_id: ORG_ID, row_id: EDIT_ROW, inserted: true, button_reply_recognized: false, echo_status_updated: false });
      case 'POST whatsapp_messages': return json(undefined, 201);
      case 'PATCH whatsapp_messages':
        return backend.patchStatus < 300 ? json(undefined, backend.patchStatus) : pgError(backend.patchStatus);
      case 'GET whatsapp_messages':
        // Busca da original = `in.(...)`; o select pós-upsert do persist = `eq.<id>`.
        if (url.searchParams.get('message_id')?.startsWith('in.')) {
          return backend.lookupStatus < 300 ? json(backend.original) : pgError(backend.lookupStatus);
        }
        return json([{ id: EDIT_ROW }]);
      case 'GET organizations': return json([{ capture_groups: backend.captureGroups }]);
      case 'POST copilot_message_queue': return json(undefined, 201);
      case 'POST whatsapp_webhook_dlq': return json(undefined, 201);
      default: throw new Error(`Unexpected backend request: ${op}`);
    }
  }));
});

const post = (payload: unknown) => new Request('https://ingress.test/whatsapp-webhook/fixture-secret', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
});
const run = async (payload: unknown) => makeHandler()(post(payload));

// Formas do raw_payload de prod (3e6ad514 / 3eb22443), identificadores trocados.
const textEdit = (over: Record<string, unknown> = {}) => ({
  EventType: 'messages', token: TOKEN,
  message: {
    id: `${OWNER}:EDIT-1`, messageid: 'EDIT-1', edited: 'ORIGINAL-1', owner: OWNER,
    chatid: '5511999887766@s.whatsapp.net', fromMe: true, type: 'text', messageType: 'ExtendedTextMessage',
    text: 'texto novo', content: { text: 'texto novo' }, messageTimestamp: Date.now(), ...over,
  },
});
const captionEdit = (over: Record<string, unknown> = {}) => textEdit({
  id: `${OWNER}:EDIT-2`, messageid: 'EDIT-2', edited: 'ORIGINAL-2', messageType: 'DocumentMessage',
  text: '', content: { caption: 'legenda nova' }, ...over,
});

const business = () => calls.map((c) => c.op)
  .filter((op) => op !== 'POST rpc/check_rate_limit' && op !== 'POST rpc/resolve_uazapi_instance');
const callsOf = (op: string) => calls.filter((c) => c.op === op);
const REACTIONS = ['POST copilot_message_queue', 'POST rpc/resolve_wait_response_by_phone'];
const reactions = () => business().filter((op) => REACTIONS.includes(op) || op.startsWith('POST fn/'));
const tenantOf = (c: Call) => ({
  organization_id: c.url.searchParams.get('organization_id'),
  instance_id: c.url.searchParams.get('instance_id'),
});
const TENANT = { organization_id: `eq.${ORG_ID}`, instance_id: `eq.${INSTANCE_ID}` };

describe.each([
  ['flag desligada', undefined],
  ['flag ligada', ORG_ID],
])('edição com %s', (_label, flag) => {
  beforeEach(() => { if (flag) env.UAZAPI_INGEST_RPC_ORGS = flag; });

  it('original encontrada: atualiza content + edited na original, sem insert e sem reações', async () => {
    const res = await run(textEdit());
    expect(res.status).toBe(200);
    expect(business()).toEqual(['GET whatsapp_messages', 'PATCH whatsapp_messages']);

    const [lookup] = callsOf('GET whatsapp_messages');
    expect(tenantOf(lookup)).toEqual(TENANT);
    expect(lookup.url.searchParams.get('message_id')).toBe(`in.(ORIGINAL-1,${OWNER}:ORIGINAL-1)`);

    const [patch] = callsOf('PATCH whatsapp_messages');
    expect(patch.body).toEqual({ content: 'texto novo', edited: true });
    expect(tenantOf(patch)).toEqual(TENANT);
    expect(patch.url.searchParams.get('id')).toBe(`eq.${ORIGINAL_ROW}`);
  });

  it('legenda de documento: a original recebe a legenda nova (o topo `text` vem vazio)', async () => {
    const res = await run(captionEdit());
    expect(res.status).toBe(200);
    expect(callsOf('PATCH whatsapp_messages')[0].body).toEqual({ content: 'legenda nova', edited: true });
    expect(callsOf('POST whatsapp_messages')).toHaveLength(0);
  });

  it('edição do cliente (incoming): não dispara copilot nem wait-response', async () => {
    const res = await run(textEdit({ fromMe: false }));
    expect(res.status).toBe(200);
    expect(business()).toEqual(['GET whatsapp_messages', 'PATCH whatsapp_messages']);
    expect(reactions()).toEqual([]);
  });

  it('original ausente: 1 linha com edited=true e o texto novo, sem copilot nem wait-response', async () => {
    backend.original = [];
    const res = await run(captionEdit({ fromMe: false }));
    expect(res.status).toBe(200);
    const inserts = callsOf('POST whatsapp_messages');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].body).toMatchObject({
      organization_id: ORG_ID, instance_id: INSTANCE_ID, message_id: `${OWNER}:EDIT-2`,
      edited: true, content: 'legenda nova', direction: 'incoming',
    });
    // A RPC recusa a chave `edited` (c_allowed): a edição vai sempre pelo upsert.
    // Sem admissão de botão: `kind='other'` resolveria uma pergunta pendente.
    expect(business()).toEqual([
      'GET whatsapp_messages',
      'POST whatsapp_messages',
      'GET whatsapp_messages',
      'POST rpc/receive_workflow_button_reply',
    ]);
    expect(reactions()).toEqual([]);
  });

  it('original ausente, edição de saída: 1 linha com edited=true, nada além do eco de status', async () => {
    backend.original = [];
    const res = await run(textEdit());
    expect(res.status).toBe(200);
    const inserts = callsOf('POST whatsapp_messages');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].body).toMatchObject({ edited: true, content: 'texto novo', direction: 'outgoing' });
    expect(business()).not.toContain('POST rpc/ingest_uazapi_message');
    expect(business()).not.toContain('POST rpc/register_workflow_button_ingress');
    expect(reactions()).toEqual([]);
  });

  it('falha na busca da original → 500, nada gravado', async () => {
    backend.lookupStatus = 500;
    const res = await run(textEdit());
    expect(res.status).toBe(500);
    expect(callsOf('PATCH whatsapp_messages')).toHaveLength(0);
    expect(callsOf('POST whatsapp_messages')).toHaveLength(0);
    expect(business()).not.toContain('POST rpc/ingest_uazapi_message');
  });

  it('falha ao gravar a edição → 500 (o provedor reentrega), sem inserir duplicata', async () => {
    backend.patchStatus = 500;
    const res = await run(textEdit());
    expect(res.status).toBe(500);
    expect(callsOf('POST whatsapp_messages')).toHaveLength(0);
    expect(reactions()).toEqual([]);
  });

  it('grupo com capture_groups=false: não busca nem grava, log de opt-out', async () => {
    backend.captureGroups = false;
    const res = await run(textEdit({ chatid: '120363001234567890@g.us', isGroup: true }));
    expect(res.status).toBe(200);
    expect(business()).toEqual(['GET organizations']);
    expect(hoist.logs.find((l) => l.action === 'uazapi_group_edit_skipped')).toMatchObject({
      organizationId: ORG_ID, payloadSnapshot: { instance_id: INSTANCE_ID, reason: 'capture_groups_off' },
    });
  });

  it('grupo com captura ligada: atualiza a original normalmente', async () => {
    const res = await run(textEdit({ chatid: '120363001234567890@g.us', isGroup: true }));
    expect(res.status).toBe(200);
    expect(business()).toEqual(['GET organizations', 'GET whatsapp_messages', 'PATCH whatsapp_messages']);
  });

  it('mensagem comum (`edited: ""`) segue o caminho de ingestão de sempre', async () => {
    const res = await run(textEdit({ id: `${OWNER}:MSG-1`, messageid: 'MSG-1', edited: '', fromMe: false }));
    expect(res.status).toBe(200);
    expect(business()[0]).toBe(flag ? 'POST rpc/ingest_uazapi_message' : 'POST rpc/register_workflow_button_ingress');
    expect(business()).toContain('POST copilot_message_queue');
    expect(callsOf('PATCH whatsapp_messages')).toHaveLength(0);
  });
});
