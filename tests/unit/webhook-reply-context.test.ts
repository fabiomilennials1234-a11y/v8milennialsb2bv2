// @vitest-environment node
/**
 * Cliente (ou o celular) cita uma mensagem: o handler grava o snapshot
 * `{messageId,text,direction}` em `reply_context` por UPDATE na linha já
 * persistida, MANTENDO `content` com o prefixo `[Em resposta a:`. Mesma técnica
 * de webhook-edited-message.test.ts: handler real, só o `fetch` é dublê.
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
  persistedReplyContext?: unknown;
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
  backend = { original: [], lookupStatus: 200, patchStatus: 204, captureGroups: true };
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


const incoming = (over: Record<string, unknown> = {}) => ({
  EventType: 'messages', token: TOKEN,
  message: {
    id: `${OWNER}:IN-1`, messageid: 'IN-1', owner: OWNER, chatid: '5511999887766@s.whatsapp.net',
    fromMe: false, type: 'text', messageType: 'ExtendedTextMessage', text: 'esse é o valor',
    content: { text: 'esse é o valor' }, messageTimestamp: Date.now(), ...over,
  },
});
const patches = () => callsOf('PATCH whatsapp_messages');
const insertedContent = () => {
  const ins = callsOf('POST whatsapp_messages')[0]?.body as Record<string, unknown> | undefined;
  return ins?.content;
};
const ORIGINAL = {
  message_id: `${OWNER}:3EB0AAAA1111BBBB2222`, content: 'Fechamos em 500k?', message_type: 'text', direction: 'outgoing',
  phone_number: '5511999887766', remote_jid: '5511999887766@s.whatsapp.net',
};

describe.each([
  ['flag desligada', undefined],
  ['flag ligada', ORG_ID],
])('reply de entrada com %s', (_label, flag) => {
  beforeEach(() => { if (flag) env.UAZAPI_INGEST_RPC_ORGS = flag; });

  it('original gravada: reply_context vem da linha, UPDATE escopado e idempotente', async () => {
    backend.original = [ORIGINAL];
    const res = await run(incoming({ quoted: '3EB0AAAA1111BBBB2222' }));
    expect(res.status).toBe(200);
    const lookup = callsOf('GET whatsapp_messages').find((c) => c.url.searchParams.get('message_id')?.startsWith('in.'))!;
    expect(lookup.url.searchParams.get('message_id')).toBe(`in.(3EB0AAAA1111BBBB2222,${OWNER}:3EB0AAAA1111BBBB2222)`);
    expect(tenantOf(lookup)).toEqual(TENANT);
    expect(patches()).toHaveLength(1);
    expect(patches()[0].body).toEqual({
      reply_context: { messageId: `${OWNER}:3EB0AAAA1111BBBB2222`, text: 'Fechamos em 500k?', direction: 'outgoing' },
    });
    expect(tenantOf(patches()[0])).toEqual(TENANT);
    expect(patches()[0].url.searchParams.get('reply_context')).toBe('is.null');
    expect(patches()[0].url.searchParams.get('id')).toBe(`eq.${EDIT_ROW}`);
  });

  it('stanzaID + quotedMessage em contextInfo: content mantém o prefixo', async () => {
    backend.original = [ORIGINAL];
    const res = await run(incoming({
      contextInfo: { stanzaID: '3EB0AAAA1111BBBB2222', quotedMessage: { conversation: 'Fechamos em 500k?' } },
    }));
    expect(res.status).toBe(200);
    if (!flag) expect(insertedContent()).toBe('[Em resposta a: "Fechamos em 500k?"]\nesse é o valor');
    expect(patches()[0].body).toMatchObject({ reply_context: { messageId: `${OWNER}:3EB0AAAA1111BBBB2222` } });
  });

  it('original ausente: snapshot com o texto do payload e o id nu', async () => {
    backend.original = [];
    const res = await run(incoming({
      content: { text: 'esse é o valor', contextInfo: { stanzaID: '3EB0EEEE5555FFFF6666', quotedMessage: { conversation: 'mensagem antiga' } } },
    }));
    expect(res.status).toBe(200);
    expect(patches()[0].body).toEqual({ reply_context: { messageId: '3EB0EEEE5555FFFF6666', text: 'mensagem antiga', direction: 'outgoing' } });
  });

  it('original de OUTRA conversa não vira citação (cai no payload)', async () => {
    backend.original = [{ ...ORIGINAL, phone_number: '5500000000000', remote_jid: '5500000000000@s.whatsapp.net' }];
    await run(incoming({
      content: { text: 'x', contextInfo: { stanzaID: '3EB0AAAA1111BBBB2222', quotedMessage: { conversation: 'do payload' } } },
    }));
    expect(patches()[0].body).toEqual({ reply_context: { messageId: '3EB0AAAA1111BBBB2222', text: 'do payload', direction: 'outgoing' } });
  });

  it('fromMe pelo celular citando algo do cliente', async () => {
    backend.original = [{ ...ORIGINAL, direction: 'incoming', message_id: `${OWNER}:3EB0CCCC3333DDDD4444`, content: 'quanto custa?' }];
    await run(incoming({ fromMe: true, quoted: '3EB0CCCC3333DDDD4444' }));
    // Com a flag desligada o eco de saída também faz um PATCH de status.
    expect(patches().find((c) => (c.body as Record<string, unknown>).reply_context)?.body).toEqual({ reply_context: { messageId: `${OWNER}:3EB0CCCC3333DDDD4444`, text: 'quanto custa?', direction: 'incoming' } });
  });

  it('mensagem sem citação: nenhum lookup de original nem UPDATE', async () => {
    const res = await run(incoming());
    expect(res.status).toBe(200);
    expect(patches()).toHaveLength(0);
    expect(callsOf('GET whatsapp_messages').filter((c) => c.url.searchParams.get('message_id')?.startsWith('in.'))).toHaveLength(0);
  });

  it('falha no UPDATE do reply_context não derruba o webhook nem as reações', async () => {
    backend.original = [ORIGINAL];
    backend.patchStatus = 500;
    const res = await run(incoming({ quoted: '3EB0AAAA1111BBBB2222' }));
    expect(res.status).toBe(200);
    expect(hoist.logs.some((l) => l.action === 'uazapi_reply_context_failed')).toBe(true);
  });
});
