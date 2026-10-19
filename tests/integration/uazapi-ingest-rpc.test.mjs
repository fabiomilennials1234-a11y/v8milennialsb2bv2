// Prova, em Postgres de verdade (PGlite, sem Docker), o contrato das RPCs da
// migration 20271201000000_uazapi_ingest_rpc.sql (F5a — 1 chamada por evento):
//   ingest_uazapi_message: admissão de botão → upsert → eco → select → receive;
//   apply_uazapi_receipt: update de status com predecessores + lookup de fallback.
// O esqueleto reproduz as colunas/constraints reais de whatsapp_messages que a
// RPC toca e troca register/receive por dublês COM AS ASSINATURAS REAIS
// (20271021000038 / 20271020000062) — o que se prova aqui é a orquestração,
// o isolamento por org e a semântica de falha, não a arbitragem do botão.
// Roda com: node --test tests/integration/uazapi-ingest-rpc.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MIG = '../../supabase/migrations/20271201000000_uazapi_ingest_rpc.sql';
const ROLLBACK = '../../supabase/migrations/rollback/20271201000000_uazapi_ingest_rpc.sql';
const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const INST_A = '00000000-0000-0000-0000-0000000000a1';
const INST_A2 = '00000000-0000-0000-0000-0000000000a2';
const INST_B = '00000000-0000-0000-0000-0000000000b1';
const MISSING = '00000000-0000-0000-0000-0000000000ff';

const SKELETON = `
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  END $$;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  CREATE TABLE public.organizations (id uuid PRIMARY KEY, capture_groups boolean DEFAULT true);
  CREATE TABLE public.whatsapp_instances (id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES public.organizations(id));
  CREATE TABLE public.whatsapp_messages (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid NOT NULL,
    instance_id uuid,
    message_id text NOT NULL,
    remote_jid text NOT NULL,
    phone_number text NOT NULL,
    direction text NOT NULL CHECK (direction IN ('incoming','outgoing')),
    message_type text DEFAULT 'text' NOT NULL,
    content text,
    media_url text,
    push_name text,
    status text DEFAULT 'received' CHECK (status IN ('pending','sent','delivered','read','received','failed')),
    "timestamp" timestamptz DEFAULT now() NOT NULL,
    created_at timestamptz DEFAULT now(),
    raw_payload jsonb,
    reactions jsonb DEFAULT '[]'::jsonb NOT NULL,
    edited boolean DEFAULT false NOT NULL,
    sent_source text DEFAULT 'manual' NOT NULL,
    received_via text DEFAULT 'webhook' NOT NULL,
    is_group boolean DEFAULT false NOT NULL,
    sent_by_team_member_id uuid,
    condition_text text,
    condition_text_source text,
    search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED,
    CONSTRAINT whatsapp_messages_message_id_instance_id_key UNIQUE (message_id, instance_id)
  );
  -- Nenhum grant de tabela a service_role: a RPC só funciona por ser DEFINER.
  REVOKE ALL ON public.whatsapp_messages, public.whatsapp_instances, public.organizations FROM PUBLIC;
  CREATE TABLE public.workflow_button_ingress (
    organization_id uuid, instance_id uuid, message_id text, source text,
    PRIMARY KEY (organization_id, instance_id, message_id));
  CREATE TABLE public.receive_calls (row_id uuid, organization_id uuid);

  CREATE FUNCTION public.register_workflow_button_ingress(p_organization_id uuid, p_instance_id uuid, p_payload jsonb, p_source text DEFAULT 'webhook'::text)
  RETURNS jsonb LANGUAGE plpgsql SET search_path TO '' AS $f$
  BEGIN
    IF p_payload->>'fail_ingress' = 'error' THEN RAISE EXCEPTION 'ingress down'; END IF;
    IF p_payload->>'fail_ingress' = 'serialization' THEN RAISE EXCEPTION 'conflict' USING ERRCODE = '40001'; END IF;
    INSERT INTO public.workflow_button_ingress VALUES (p_organization_id, p_instance_id, p_payload->>'id', p_source)
      ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('recognized', true);
  END $f$;
  CREATE FUNCTION public.receive_workflow_button_reply(p_message_row_id uuid, p_organization_id uuid)
  RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $f$
  DECLARE m public.whatsapp_messages;
  BEGIN
    INSERT INTO public.receive_calls VALUES (p_message_row_id, p_organization_id);
    SELECT * INTO m FROM public.whatsapp_messages WHERE id = p_message_row_id AND organization_id = p_organization_id;
    IF m.raw_payload->>'fail_receive' = 'true' THEN RAISE EXCEPTION 'receive down'; END IF;
    IF m.raw_payload->>'fail_receive' = 'cancel' THEN
      RAISE EXCEPTION 'canceling statement due to statement timeout' USING ERRCODE = 'query_canceled';
    END IF;
    RETURN jsonb_build_object('recognized', EXISTS (SELECT 1 FROM public.workflow_button_ingress i
      WHERE i.organization_id = p_organization_id AND i.instance_id = m.instance_id AND i.message_id = m.message_id
        AND m.raw_payload->>'button' = 'true'), 'resolved', false);
  END $f$;
  REVOKE ALL ON FUNCTION public.register_workflow_button_ingress(uuid,uuid,jsonb,text), public.receive_workflow_button_reply(uuid,uuid) FROM PUBLIC;

  -- Como no Supabase: função nova nasce executável por anon/authenticated.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

  INSERT INTO public.organizations VALUES ('${ORG_A}', true), ('${ORG_B}', false);
  INSERT INTO public.whatsapp_instances VALUES ('${INST_A}', '${ORG_A}'), ('${INST_A2}', '${ORG_A}'), ('${INST_B}', '${ORG_B}');
`;

async function setup(migrationSql = read(MIG)) {
  const db = new PGlite();
  await db.exec(SKELETON);
  await db.exec(migrationSql);
  return db;
}

// Mesmo formato do NormalizedMessage que a edge manda (todas as chaves sempre presentes).
const normalized = (over = {}) => ({
  organization_id: ORG_A, instance_id: INST_A, message_id: 'MSG-1',
  remote_jid: '5511988887777@s.whatsapp.net', phone_number: '5511988887777',
  direction: 'incoming', message_type: 'text', content: 'oi', condition_text: 'oi',
  condition_text_source: 'text', media_url: null, push_name: 'Fulano', status: 'received',
  timestamp: '2026-10-19T12:00:00.000Z', raw_payload: { id: 'MSG-1' }, is_group: false,
  received_via: 'webhook', ...over,
});

async function ingest(db, { instance = INST_A, payload = { id: 'MSG-1' }, message = normalized(), source = 'webhook', prior = [] } = {}) {
  const r = await db.query(
    'SELECT public.ingest_uazapi_message($1::uuid, $2::jsonb, $3::jsonb, $4, $5::text[]) AS r',
    [instance, JSON.stringify(payload), message === null ? null : JSON.stringify(message), source, prior],
  );
  return r.rows[0].r;
}
const rows = async (db, sql, params = []) => (await db.query(sql, params)).rows;
const errorCode = async (p) => { try { await p; } catch (e) { return e.code; } return null; };

test('insere mensagem nova: status persisted, inserted=true, defaults das colunas ausentes', async () => {
  const db = await setup();
  try {
    const r = await ingest(db);
    assert.equal(r.status, 'persisted');
    assert.equal(r.inserted, true);
    assert.equal(r.organization_id, ORG_A);
    assert.equal(r.button_reply_recognized, false);
    const [row] = await rows(db, `SELECT id, reactions, sent_source, edited, received_via, "timestamp", status, sent_by_team_member_id
      FROM public.whatsapp_messages WHERE message_id = 'MSG-1'`);
    assert.equal(row.id, r.row_id);
    assert.deepEqual(row.reactions, []);
    assert.equal(row.sent_source, 'manual');
    assert.equal(row.edited, false);
    assert.equal(row.status, 'received');
    assert.equal(row.sent_by_team_member_id, null);
    assert.equal(new Date(row.timestamp).toISOString(), '2026-10-19T12:00:00.000Z');
    assert.equal((await rows(db, 'SELECT 1 FROM public.workflow_button_ingress')).length, 1);
    assert.deepEqual(await rows(db, 'SELECT row_id FROM public.receive_calls'), [{ row_id: r.row_id }]);
  } finally { await db.close(); }
});

test('duplicada: inserted=false e devolve o MESMO row_id; conteúdo original intacto', async () => {
  const db = await setup();
  try {
    const first = await ingest(db);
    const second = await ingest(db, { message: normalized({ content: 'reescrito' }) });
    assert.equal(second.status, 'persisted');
    assert.equal(second.inserted, false);
    assert.equal(second.row_id, first.row_id);
    assert.deepEqual(await rows(db, 'SELECT content FROM public.whatsapp_messages'), [{ content: 'oi' }]);
  } finally { await db.close(); }
});

test('instância inexistente: PT404, nunca 40001, nada gravado', async () => {
  const db = await setup();
  try {
    assert.equal(await errorCode(ingest(db, { instance: MISSING })), 'PT404');
    assert.equal((await rows(db, 'SELECT 1 FROM public.workflow_button_ingress')).length, 0);
    assert.equal((await rows(db, 'SELECT 1 FROM public.whatsapp_messages')).length, 0);
  } finally { await db.close(); }
});

test('falha na admissão: erro propaga e nada é gravado; 40001 vira PT409', async () => {
  const db = await setup();
  try {
    assert.notEqual(await errorCode(ingest(db, { payload: { id: 'MSG-1', fail_ingress: 'error' } })), null);
    assert.equal(await errorCode(ingest(db, { payload: { id: 'MSG-1', fail_ingress: 'serialization' } })), 'PT409');
    assert.equal((await rows(db, 'SELECT 1 FROM public.whatsapp_messages')).length, 0);
  } finally { await db.close(); }
});

test('org/instance forjadas no payload são ignoradas: linha fica com a org da instância', async () => {
  const db = await setup();
  try {
    const r = await ingest(db, { message: normalized({ organization_id: ORG_B, instance_id: INST_B }) });
    assert.equal(r.organization_id, ORG_A);
    assert.deepEqual(await rows(db, 'SELECT organization_id, instance_id FROM public.whatsapp_messages'),
      [{ organization_id: ORG_A, instance_id: INST_A }]);
    assert.deepEqual(await rows(db, 'SELECT organization_id FROM public.workflow_button_ingress'), [{ organization_id: ORG_A }]);
  } finally { await db.close(); }
});

test('upsert falha (NOT NULL): admissão do botão persiste e status upsert_failed', async () => {
  const db = await setup();
  try {
    const r = await ingest(db, { message: normalized({ phone_number: null }) });
    assert.equal(r.status, 'upsert_failed');
    assert.equal(r.sqlstate, '23502');
    assert.match(r.error_message, /phone_number/);
    assert.equal((await rows(db, 'SELECT 1 FROM public.workflow_button_ingress')).length, 1);
    assert.equal((await rows(db, 'SELECT 1 FROM public.whatsapp_messages')).length, 0);
  } finally { await db.close(); }
});

test('chave desconhecida falha como PGRST204 falhava (upsert_failed), sem SQL dinâmico injetável', async () => {
  const db = await setup();
  try {
    const r = await ingest(db, { message: { ...normalized(), 'id) VALUES (1); --': 'x' } });
    assert.equal(r.status, 'upsert_failed');
    assert.equal(r.sqlstate, '42703');
    assert.equal((await rows(db, 'SELECT 1 FROM public.workflow_button_ingress')).length, 1);
  } finally { await db.close(); }
});

test('sem message_id: só admissão, status no_message_id', async () => {
  const db = await setup();
  try {
    assert.equal((await ingest(db, { message: null })).status, 'no_message_id');
    assert.equal((await ingest(db, { message: normalized({ message_id: null }) })).status, 'no_message_id');
    assert.equal((await rows(db, 'SELECT 1 FROM public.workflow_button_ingress')).length, 1);
    assert.equal((await rows(db, 'SELECT 1 FROM public.whatsapp_messages')).length, 0);
  } finally { await db.close(); }
});

test('grupo: capture_groups=false pula; true persiste sem receive', async () => {
  const db = await setup();
  try {
    const skipped = await ingest(db, { instance: INST_B, message: normalized({ is_group: true, message_id: 'G-1' }) });
    assert.equal(skipped.status, 'group_skipped');
    assert.equal((await rows(db, 'SELECT 1 FROM public.whatsapp_messages')).length, 0);

    const captured = await ingest(db, { message: normalized({ is_group: true, message_id: 'G-2' }) });
    assert.equal(captured.status, 'persisted');
    assert.equal((await rows(db, 'SELECT 1 FROM public.receive_calls')).length, 0);

    // capture_groups NULL = captura (fail-open igual ao caminho antigo).
    await db.exec(`UPDATE public.organizations SET capture_groups = NULL WHERE id = '${ORG_B}'`);
    const nullCapture = await ingest(db, { instance: INST_B, message: normalized({ is_group: true, message_id: 'G-3' }) });
    assert.equal(nullCapture.status, 'persisted');
  } finally { await db.close(); }
});

test('eco de saída: promove só status anteriores e sinaliza echo_status_updated', async () => {
  const db = await setup();
  try {
    await db.exec(`INSERT INTO public.whatsapp_messages (organization_id, instance_id, message_id, remote_jid, phone_number, direction, status)
      VALUES ('${ORG_A}', '${INST_A}', 'OUT-1', 'j', 'p', 'outgoing', 'pending'),
             ('${ORG_A}', '${INST_A}', 'OUT-2', 'j', 'p', 'outgoing', 'read')`);
    const out = (id, status) => normalized({ message_id: id, direction: 'outgoing', status });
    const r1 = await ingest(db, { message: out('OUT-1', 'delivered'), prior: ['pending', 'sent'] });
    assert.equal(r1.status, 'persisted');
    assert.equal(r1.echo_status_updated, true);
    assert.equal(r1.inserted, false);
    const r2 = await ingest(db, { message: out('OUT-2', 'delivered'), prior: ['pending', 'sent'] });
    assert.equal(r2.echo_status_updated, true);
    const r3 = await ingest(db, { message: out('OUT-3', 'sent'), prior: [] });
    assert.equal(r3.echo_status_updated, false);
    assert.deepEqual(await rows(db, `SELECT message_id, status FROM public.whatsapp_messages ORDER BY message_id`), [
      { message_id: 'OUT-1', status: 'delivered' },
      { message_id: 'OUT-2', status: 'read' },
      { message_id: 'OUT-3', status: 'sent' },
    ]);
    assert.equal((await rows(db, 'SELECT 1 FROM public.receive_calls')).length, 0);
  } finally { await db.close(); }
});

test('eco: falha no update vira echo_status_failed sem desfazer admissão nem linha', async () => {
  const db = await setup();
  try {
    await db.exec(`INSERT INTO public.whatsapp_messages (organization_id, instance_id, message_id, remote_jid, phone_number, direction, status)
      VALUES ('${ORG_A}', '${INST_A}', 'OUT-9', 'j', 'p', 'outgoing', 'pending');
      CREATE FUNCTION public.boom() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'update down'; END $f$;
      CREATE TRIGGER boom BEFORE UPDATE ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION public.boom();`);
    const r = await ingest(db, { message: normalized({ message_id: 'OUT-9', direction: 'outgoing', status: 'delivered' }), prior: ['pending'] });
    assert.equal(r.status, 'echo_status_failed');
    assert.equal((await rows(db, 'SELECT 1 FROM public.workflow_button_ingress')).length, 1);
    assert.deepEqual(await rows(db, `SELECT status FROM public.whatsapp_messages WHERE message_id = 'OUT-9'`), [{ status: 'pending' }]);
  } finally { await db.close(); }
});

test('receive falha: button_reply_failed, mensagem e admissão continuam gravadas', async () => {
  const db = await setup();
  try {
    const r = await ingest(db, { message: normalized({ raw_payload: { id: 'MSG-1', fail_receive: 'true' } }) });
    assert.equal(r.status, 'button_reply_failed');
    assert.ok(r.row_id);
    assert.equal((await rows(db, 'SELECT 1 FROM public.whatsapp_messages')).length, 1);
    assert.equal((await rows(db, 'SELECT 1 FROM public.workflow_button_ingress')).length, 1);
    // O savepoint também desfez o efeito parcial do receive (como a transação separada antiga).
    assert.equal((await rows(db, 'SELECT 1 FROM public.receive_calls')).length, 0);
  } finally { await db.close(); }
});

test('receive reconhece resposta de botão: button_reply_recognized=true', async () => {
  const db = await setup();
  try {
    const r = await ingest(db, { message: normalized({ raw_payload: { id: 'MSG-1', button: 'true' } }) });
    assert.equal(r.button_reply_recognized, true);
  } finally { await db.close(); }
});

test('linha de outra org com o mesmo (message_id, instance_id): missing_row, nada vaza', async () => {
  const db = await setup();
  try {
    // Instância transferida de org: a linha antiga ficou com a org de origem.
    await db.exec(`INSERT INTO public.whatsapp_messages (organization_id, instance_id, message_id, remote_jid, phone_number, direction)
      VALUES ('${ORG_B}', '${INST_A}', 'MSG-1', 'j', 'p', 'incoming')`);
    const r = await ingest(db);
    assert.equal(r.status, 'missing_row');
    assert.equal(r.row_id, undefined);
    assert.equal((await rows(db, 'SELECT 1 FROM public.receive_calls')).length, 0);
  } finally { await db.close(); }
});

async function receipt(db, ids, status, predecessors, instance = INST_A) {
  return (await db.query('SELECT public.apply_uazapi_receipt($1::uuid, $2::text[], $3, $4::text[]) AS r',
    [instance, ids, status, predecessors])).rows[0].r;
}

test('recibo: respeita predecessores, só outgoing, outra org/instância não é tocada', async () => {
  const db = await setup();
  try {
    await db.exec(`INSERT INTO public.whatsapp_messages (organization_id, instance_id, message_id, remote_jid, phone_number, direction, status) VALUES
      ('${ORG_A}', '${INST_A}', 'R-1', 'j', 'p', 'outgoing', 'sent'),
      ('${ORG_A}', '${INST_A}', 'R-2', 'j', 'p', 'outgoing', 'read'),
      ('${ORG_A}', '${INST_A}', 'R-3', 'j', 'p', 'incoming', 'received'),
      ('${ORG_A}', '${INST_A2}', 'R-1', 'j', 'p', 'outgoing', 'sent'),
      ('${ORG_B}', '${INST_B}', 'R-1', 'j', 'p', 'outgoing', 'sent')`);
    const r = await receipt(db, ['R-1', 'R-2', 'R-3'], 'delivered', ['pending', 'sent', 'failed']);
    assert.deepEqual(r, { changed_count: 1, has_outgoing: true });
    assert.deepEqual(await rows(db, `SELECT organization_id, instance_id, message_id, status FROM public.whatsapp_messages ORDER BY organization_id, instance_id, message_id`), [
      { organization_id: ORG_A, instance_id: INST_A, message_id: 'R-1', status: 'delivered' },
      { organization_id: ORG_A, instance_id: INST_A, message_id: 'R-2', status: 'read' },
      { organization_id: ORG_A, instance_id: INST_A, message_id: 'R-3', status: 'received' },
      { organization_id: ORG_A, instance_id: INST_A2, message_id: 'R-1', status: 'sent' },
      { organization_id: ORG_B, instance_id: INST_B, message_id: 'R-1', status: 'sent' },
    ]);
    // Nada mudou mas existe outgoing (recibo atrasado) → has_outgoing=true.
    assert.deepEqual(await receipt(db, ['R-2'], 'delivered', ['pending', 'sent', 'failed']), { changed_count: 0, has_outgoing: true });
    // Só incoming / inexistente → has_outgoing=false (edge loga uazapi_receipt_unmatched).
    assert.deepEqual(await receipt(db, ['R-3', 'NOPE'], 'read', ['pending', 'sent', 'delivered', 'failed']), { changed_count: 0, has_outgoing: false });
    assert.deepEqual(await receipt(db, [], 'read', ['sent']), { changed_count: 0, has_outgoing: false });
  } finally { await db.close(); }
});

test('recibo: entrada fora do domínio → PT400; instância inexistente → PT404', async () => {
  const db = await setup();
  try {
    assert.equal(await errorCode(receipt(db, ['R'], 'pending', ['sent'])), 'PT400');
    assert.equal(await errorCode(receipt(db, ['R'], 'read', [])), 'PT400');
    assert.equal(await errorCode(receipt(db, ['R'], 'read', ['read'])), 'PT400');
    assert.equal(await errorCode(receipt(db, ['R'], 'read', ['received'])), 'PT400');
    assert.equal(await errorCode(receipt(db, ['R'], 'read', ['sent'], MISSING)), 'PT404');
  } finally { await db.close(); }
});

test('grants: só service_role executa; DEFINER funciona sem grant de tabela; anon/authenticated negados', async () => {
  const db = await setup();
  try {
    const priv = await rows(db, `SELECT p.proname,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
        has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_x,
        p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('ingest_uazapi_message', 'apply_uazapi_receipt') ORDER BY 1`);
    assert.deepEqual(priv, [
      { proname: 'apply_uazapi_receipt', anon_x: false, auth_x: false, svc_x: true, prosecdef: true, proconfig: ['search_path=""'] },
      { proname: 'ingest_uazapi_message', anon_x: false, auth_x: false, svc_x: true, prosecdef: true, proconfig: ['search_path=""'] },
    ]);
    // Controle: o esqueleto reproduz o default do Supabase (função nova executável
    // por anon) — sem isso o REVOKE da migration não estaria sendo testado.
    await db.exec('CREATE FUNCTION public.probe_default_grant() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$');
    assert.deepEqual(await rows(db, `SELECT has_function_privilege('anon', 'public.probe_default_grant()', 'EXECUTE') AS x`), [{ x: true }]);
    await db.exec('SET ROLE service_role');
    assert.equal((await ingest(db)).status, 'persisted');
    await db.exec('RESET ROLE; SET ROLE anon');
    assert.equal(await errorCode(ingest(db)), '42501');
    await db.exec('RESET ROLE; SET ROLE authenticated');
    assert.equal(await errorCode(receipt(db, ['MSG-1'], 'read', ['sent'])), '42501');
    await db.exec('RESET ROLE');
  } finally { await db.close(); }
});

test('migration reaplicada é idempotente; rollback remove as duas funções', async () => {
  const db = await setup();
  try {
    await db.exec(read(MIG));
    assert.equal((await ingest(db)).status, 'persisted');
    await db.exec(read(ROLLBACK));
    const left = await rows(db, `SELECT 1 FROM pg_proc WHERE proname IN ('ingest_uazapi_message', 'apply_uazapi_receipt')`);
    assert.equal(left.length, 0);
    await db.exec(read(ROLLBACK));
  } finally { await db.close(); }
});

// ─── 57014 (query_canceled) ────────────────────────────────────────────────
// Prod: authenticator com statement_timeout=8s. `WHEN OTHERS` NÃO pega 57014;
// sem o handler nomeado, um timeout no upsert/eco/receive derrubaria a admissão
// do botão junto. PGlite não cancela por tempo: o cancelamento é simulado por
// RAISE com o MESMO SQLSTATE no ponto exato em que o timeout cairia.
const CANCEL_FN = `CREATE FUNCTION public.cancel_now() RETURNS trigger LANGUAGE plpgsql AS $f$
  BEGIN RAISE EXCEPTION 'canceling statement due to statement timeout' USING ERRCODE = 'query_canceled'; END $f$;`;
const cancelScenarios = [
  {
    name: 'timeout no INSERT → upsert_failed',
    expect: 'upsert_failed',
    prep: `${CANCEL_FN} CREATE TRIGGER cancel_insert BEFORE INSERT ON public.whatsapp_messages
      FOR EACH ROW EXECUTE FUNCTION public.cancel_now();`,
    run: (db) => ingest(db),
  },
  {
    name: 'timeout no UPDATE do eco → echo_status_failed',
    expect: 'echo_status_failed',
    prep: `INSERT INTO public.whatsapp_messages (organization_id, instance_id, message_id, remote_jid, phone_number, direction, status)
      VALUES ('${ORG_A}', '${INST_A}', 'OUT-T', 'j', 'p', 'outgoing', 'pending');
      ${CANCEL_FN} CREATE TRIGGER cancel_update BEFORE UPDATE ON public.whatsapp_messages
      FOR EACH ROW EXECUTE FUNCTION public.cancel_now();`,
    run: (db) => ingest(db, { payload: { id: 'OUT-T' },
      message: normalized({ message_id: 'OUT-T', direction: 'outgoing', status: 'delivered' }), prior: ['pending', 'sent'] }),
  },
  {
    name: 'timeout dentro do receive → button_reply_failed',
    expect: 'button_reply_failed',
    prep: '',
    run: (db) => ingest(db, { message: normalized({ raw_payload: { id: 'MSG-1', fail_receive: 'cancel' } }) }),
  },
];

for (const sc of cancelScenarios) {
  test(`57014: ${sc.name}; admissão do botão sobrevive`, async () => {
    const db = await setup();
    try {
      if (sc.prep) await db.exec(sc.prep);
      const r = await sc.run(db);
      assert.equal(r.status, sc.expect);
      assert.equal((await rows(db, 'SELECT 1 FROM public.workflow_button_ingress')).length, 1);
    } finally { await db.close(); }
  });

  // Controle positivo: o MESMO cenário contra a função sem o handler nomeado
  // reverte a admissão. Prova que o teste acima distingue o defeito.
  test(`57014 controle: ${sc.name} SEM handler → erro 57014 e admissão revertida`, async () => {
    const withoutHandler = read(MIG).replaceAll(' OR query_canceled', '');
    assert.notEqual(withoutHandler, read(MIG));
    const db = await setup(withoutHandler);
    try {
      if (sc.prep) await db.exec(sc.prep);
      assert.equal(await errorCode(sc.run(db)), '57014');
      assert.equal((await rows(db, 'SELECT 1 FROM public.workflow_button_ingress')).length, 0);
    } finally { await db.close(); }
  });
}

test('capture_groups: leitura que falha (erro ou 57014) = captura, fail-open do caminho antigo', async () => {
  for (const code of ['XX000', 'query_canceled']) {
    const db = await setup();
    try {
      // organizations vira view cuja leitura falha; a FK continua na tabela base.
      await db.exec(`ALTER TABLE public.organizations RENAME TO organizations_base;
        CREATE FUNCTION public.capture_boom(uuid) RETURNS boolean LANGUAGE plpgsql AS $f$
          BEGIN RAISE EXCEPTION 'org read down' USING ERRCODE = '${code}'; END $f$;
        CREATE VIEW public.organizations AS SELECT id, public.capture_boom(id) AS capture_groups FROM public.organizations_base;`);
      const r = await ingest(db, { instance: INST_B, message: normalized({ is_group: true, message_id: 'G-F' }) });
      assert.equal(r.status, 'persisted', code);
      assert.equal((await rows(db, `SELECT 1 FROM public.whatsapp_messages WHERE message_id = 'G-F'`)).length, 1);
    } finally { await db.close(); }
  }
});
