// get_whatsapp_conversation_list_multi sem varredura por mensagem
// (20280117000000_lista_de_conversas_sem_varredura_por_mensagem.sql).
//
// A migration reescreve três trechos da função por desempenho (CTE read_state
// varrida por mensagem, corte de tempo como filtro em vez de condição de
// índice, expansão de chips por chamada de função) e o FILTRO de não-lida
// (poda pelo resumo). A promessa é: MESMA saída, linha a linha.
//
// Provado aqui, como `authenticated` COM claims:
//   a. equivalência: a função antiga (o rollback, que é o corpo VIVO de prod em
//      16/11/2026) e a nova devolvem exatamente as mesmas linhas, na mesma
//      ordem, em 7 cenários (padrão, não-lidas, aguardando, com grupos, página 2
//      por cursor composto, caixa única, limite pequeno) × 2 usuários × isolamento
//      por responsável ligado/desligado — sobre um conjunto que exercita: chip
//      com uuid histórico (reap_queue), leitura gravada no chip ANTIGO, telefone
//      que fala com duas caixas, marcada-como-não-lida, mensagem fora da janela
//      de 30 dias, mensagem apagada, grupo, cursor com empate de timestamp;
//   b. forma de prod: com o recorte strict instalado, o bloco DO troca as 8
//      relações para private.*, deixa zero public.<rel> e exatamente 25
//      `private.` no corpo; a leitura de marcadas-não-lidas fica na TABELA;
//   c. forma do repo (sem strict, sem private.*): a migration aplica, nada é
//      trocado, e a função roda — os desvios JR Tex/Riofix são guardados;
//   d. ACL igual à de prod: só authenticated (+ owner) executa;
//   e. desvios de prod no caminho VERDADEIRO: escopo de funil JR Tex ligado
//      (lead em funil visível e fora dele) e balcão Riofix com isolamento
//      ligado — antiga × nova, mesma saída;
//   f. falha FECHADA: forma de prod sem uma das funções JR Tex/Riofix → o
//      apply aborta (o escopo nunca abre em silêncio);
//   g. gate de org: usuário de outra org recebe 42501, nas duas versões.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MIG = read('../../supabase/migrations/20280117000000_lista_de_conversas_sem_varredura_por_mensagem.sql');
const RB = read('../../supabase/migrations/rollback/20280117000000_lista_de_conversas_sem_varredura_por_mensagem.sql');

const SIG = 'public.get_whatsapp_conversation_list_multi(uuid,uuid[],integer,timestamp with time zone,uuid[],text[],uuid[],text[],uuid,boolean,text,boolean,boolean,boolean,text,boolean,uuid,text)';
const RELS = ['conversation_read_state', 'conversations', 'lead_tags', 'leads', 'pipeline_entries',
  'whatsapp_conversation_summary', 'whatsapp_conversations', 'whatsapp_messages'];

const id = (p, n) => `${p}000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`;
const ORG = id('0a', 1);
const ORG2 = id('0a', 2);
const U = { adm: id('0b', 1), mem: id('0b', 2) };
const U_FORA = id('0b', 9);
const TM = { adm: id('0c', 1), mem: id('0c', 2) };
const PIPE = { visivel: id('09', 1), oculto: id('09', 2) };
// Caixa A tem um uuid HISTÓRICO (A_OLD) do mesmo número, na reap_queue.
const A = id('0d', 1), A_OLD = id('0d', 2), B = id('0d', 3);
const NUM_A = '+55 (48) 99999-0001', NUM_B = '5548999990002';
const L1 = id('0e', 1), L2 = id('0e', 2);
const P = {
  p1: '5548900000001', // A: 3 recebidas; leitura no meio → 2 não-lidas
  p2: '5548900000002', // A_OLD (chip antigo): recebida há 2 h, nunca lida → 1
  p3: '5548900000003', // A: só mensagem de 40 dias atrás → fora da janela
  p4: '5548900000004', // A: marcada como não-lida, sem mensagem recente
  p5: '5548900000005', // A: recebida há 3 d, LIDA no chip antigo há 1 d → 0
  p6: '5548900000006', // A e B: fala com as duas caixas
  p7: '5548900000007', // A: recebida apagada → não conta
  p8: '5548900000008', // A: empate de timestamp com p9 (cursor)
  p9: '5548900000009',
  g1: '120363000000000001', // grupo
};

const SKELETON = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.organizations (id uuid PRIMARY KEY, chat_restrict_to_owner boolean NOT NULL DEFAULT false,
  feature_flags jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.team_members (id uuid PRIMARY KEY, user_id uuid, organization_id uuid,
  is_active boolean NOT NULL DEFAULT true, role text NOT NULL DEFAULT 'member', name text);
CREATE TABLE public.master_users (user_id uuid, is_active boolean);
CREATE TABLE public.member_feature_permissions (team_member_id uuid, feature_key text, enabled boolean);
CREATE TABLE public.leads (id uuid PRIMARY KEY, organization_id uuid, normalized_phone text, deleted_at timestamptz,
  pre_sale_responsible_id uuid, sale_responsible_id uuid, sdr_id uuid, closer_id uuid, responsible_id uuid,
  qualification_tier text);
CREATE TABLE public.lead_owners (lead_id uuid, organization_id uuid, team_member_id uuid, role text);
CREATE TABLE public.pipeline_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, lead_id uuid,
  pipeline_id uuid, stage_key text, assigned_to uuid, metadata jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.conversations (organization_id uuid, lead_id uuid, state text);
CREATE TABLE public.conversation_read_state (organization_id uuid, user_id uuid, conversation_key text,
  last_read_at timestamptz, marked_unread boolean NOT NULL DEFAULT false,
  UNIQUE (organization_id, user_id, conversation_key));
CREATE TABLE public.whatsapp_instances (id uuid PRIMARY KEY, organization_id uuid, phone_number text);
CREATE TABLE public.whatsapp_instance_reap_queue (instance_id uuid, organization_id uuid, phone_number text);
CREATE TABLE public.whatsapp_conversations (id uuid PRIMARY KEY, organization_id uuid, instance_id uuid,
  normalized_phone text, archived_at timestamptz, deleted_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.whatsapp_conversation_summary (organization_id uuid, instance_id uuid, normalized_phone text,
  phone_number text, last_push_name text, last_message text, last_message_time timestamptz,
  last_message_direction text, last_message_sent_source text, lead_id uuid, is_group boolean NOT NULL DEFAULT false,
  PRIMARY KEY (organization_id, instance_id, normalized_phone));
CREATE TABLE public.whatsapp_messages (organization_id uuid, instance_id uuid, normalized_phone text, direction text,
  deleted_at timestamptz, is_group boolean NOT NULL DEFAULT false, "timestamp" timestamptz,
  content text, sent_source text, push_name text);
CREATE TABLE public.tags (id uuid PRIMARY KEY, organization_id uuid NOT NULL, name text NOT NULL, color text);
CREATE TABLE public.lead_tags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid, tag_id uuid,
  created_at timestamptz DEFAULT now(), UNIQUE (lead_id, tag_id));
CREATE TABLE public.whatsapp_conversation_tags (conversation_id uuid, tag_id uuid, UNIQUE (conversation_id, tag_id));

CREATE FUNCTION public.is_master_user(_user_id uuid DEFAULT auth.uid()) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.master_users WHERE user_id = _user_id AND is_active) $$;
CREATE FUNCTION public.get_my_organization_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public' AS $$
  SELECT organization_id FROM public.team_members WHERE user_id = auth.uid() AND is_active $$;
CREATE FUNCTION public.whatsapp_readable_instance_ids(p_org uuid, p_instances uuid[]) RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(array_agg(wi.id ORDER BY wi.id), '{}') FROM public.whatsapp_instances wi
   WHERE wi.organization_id = p_org
     AND (p_instances IS NULL OR cardinality(p_instances) = 0 OR wi.id = ANY(p_instances)) $$;
-- Regra de prod de whatsapp_chip_instance_ids (sem o gate, que é o mesmo da
-- função chamadora): a caixa + os uuids da reap_queue com os mesmos dígitos.
CREATE FUNCTION public.whatsapp_chip_instance_ids(p_org uuid, p_instance uuid) RETURNS uuid[]
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_digits text; v_ids uuid[];
BEGIN
  SELECT regexp_replace(w.phone_number, '[^0-9]', '', 'g') INTO v_digits
    FROM public.whatsapp_instances w WHERE w.id = p_instance AND w.organization_id = p_org;
  IF v_digits IS NULL OR length(v_digits) < 10 THEN RETURN ARRAY[p_instance]; END IF;
  SELECT array_agg(DISTINCT s.id) INTO v_ids FROM (
    SELECT p_instance AS id
    UNION
    SELECT q.instance_id FROM public.whatsapp_instance_reap_queue q
     WHERE q.organization_id = p_org AND q.phone_number IS NOT NULL
       AND regexp_replace(q.phone_number, '[^0-9]', '', 'g') = v_digits) s;
  RETURN COALESCE(v_ids, ARRAY[p_instance]);
END $$;
CREATE FUNCTION public.is_org_admin(p_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public' AS $$
  SELECT COALESCE(public.is_master_user(), false) OR EXISTS (SELECT 1 FROM public.team_members
   WHERE user_id = auth.uid() AND organization_id = p_org AND role = 'admin' AND is_active) $$;
CREATE FUNCTION public.rls_lead_co_owned(p_lead uuid, p_tms uuid[]) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.lead_owners o WHERE o.lead_id = p_lead AND o.role = 'co'
   AND o.team_member_id = ANY(p_tms)) $$;
-- prod, verbatim
CREATE FUNCTION public.is_conversation_marked_unread(p_org uuid, p_instance uuid, p_phone text)
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $$
 SELECT EXISTS (SELECT 1 FROM public.conversation_read_state
 WHERE organization_id = p_org AND user_id = auth.uid()
 AND conversation_key = 'whatsapp:' || p_instance::text || ':' || p_phone AND marked_unread);
$$;

INSERT INTO public.organizations(id) VALUES ('${ORG}'), ('${ORG2}');
INSERT INTO public.team_members(id, user_id, organization_id, role) VALUES ('${id('0c', 9)}', '${U_FORA}', '${ORG2}', 'admin');
-- L1 num funil visível ao escopo JR Tex; L2 num funil fora dele.
INSERT INTO public.pipeline_entries(organization_id, lead_id, pipeline_id, stage_key) VALUES
  ('${ORG}', '${id('0e', 1)}', '${PIPE.visivel}', 'novo'),
  ('${ORG}', '${id('0e', 2)}', '${PIPE.oculto}', 'novo');
INSERT INTO public.team_members(id, user_id, organization_id, role) VALUES
  ('${TM.adm}', '${U.adm}', '${ORG}', 'admin'),
  ('${TM.mem}', '${U.mem}', '${ORG}', 'member');
INSERT INTO public.whatsapp_instances VALUES ('${A}', '${ORG}', '${NUM_A}'), ('${B}', '${ORG}', '${NUM_B}');
INSERT INTO public.whatsapp_instance_reap_queue VALUES ('${A_OLD}', '${ORG}', '5548999990001');
-- L1 é do membro (isolamento deixa ver p1); L2 é de ninguém.
INSERT INTO public.leads(id, organization_id, normalized_phone, sale_responsible_id) VALUES
  ('${L1}', '${ORG}', '${P.p1}', '${TM.mem}'),
  ('${L2}', '${ORG}', '${P.p6}', NULL);
INSERT INTO public.member_feature_permissions VALUES ('${TM.mem}', 'leads.view_unassigned', true);

-- Mensagens (relativas a now(); o resumo é derivado delas como o trigger faz).
INSERT INTO public.whatsapp_messages
  (organization_id, instance_id, normalized_phone, direction, deleted_at, is_group, "timestamp", content, sent_source, push_name) VALUES
  ('${ORG}', '${A}', '${P.p1}', 'incoming', NULL, false, now() - interval '10 minutes', 'a', NULL, 'Um'),
  ('${ORG}', '${A}', '${P.p1}', 'incoming', NULL, false, now() - interval '5 minutes', 'b', NULL, 'Um'),
  ('${ORG}', '${A}', '${P.p1}', 'incoming', NULL, false, now() - interval '1 minute', 'c', NULL, 'Um'),
  ('${ORG}', '${A_OLD}', '${P.p2}', 'incoming', NULL, false, now() - interval '2 hours', 'd', NULL, 'Dois'),
  ('${ORG}', '${A}', '${P.p3}', 'incoming', NULL, false, now() - interval '40 days', 'e', NULL, 'Tres'),
  ('${ORG}', '${A}', '${P.p4}', 'outgoing', NULL, false, now() - interval '20 days', 'f', 'manual', NULL),
  ('${ORG}', '${A}', '${P.p5}', 'incoming', NULL, false, now() - interval '3 days', 'g', NULL, 'Cinco'),
  ('${ORG}', '${A}', '${P.p5}', 'outgoing', NULL, false, now() - interval '2 days', 'h', 'copilot', NULL),
  ('${ORG}', '${A}', '${P.p6}', 'incoming', NULL, false, now() - interval '30 minutes', 'i', NULL, 'Seis'),
  ('${ORG}', '${B}', '${P.p6}', 'incoming', NULL, false, now() - interval '20 minutes', 'j', NULL, 'Seis'),
  ('${ORG}', '${B}', '${P.p6}', 'incoming', NULL, false, now() - interval '15 minutes', 'k', NULL, 'Seis'),
  ('${ORG}', '${A}', '${P.p7}', 'incoming', now(), false, now() - interval '4 minutes', 'l', NULL, 'Sete'),
  ('${ORG}', '${A}', '${P.p8}', 'incoming', NULL, false, date_trunc('hour', now()) - interval '5 hours', 'm', NULL, 'Oito'),
  ('${ORG}', '${A}', '${P.p9}', 'outgoing', NULL, false, date_trunc('hour', now()) - interval '5 hours', 'n', 'workflow', NULL),
  ('${ORG}', '${A}', '${P.g1}', 'incoming', NULL, true, now() - interval '3 minutes', 'o', NULL, 'Grupo');

INSERT INTO public.whatsapp_conversation_summary
SELECT DISTINCT ON (m.organization_id, m.instance_id, m.normalized_phone)
       m.organization_id, m.instance_id, m.normalized_phone, m.normalized_phone, m.push_name, m.content,
       m."timestamp", m.direction, m.sent_source,
       (SELECT l.id FROM public.leads l WHERE l.normalized_phone = m.normalized_phone), m.is_group
  FROM public.whatsapp_messages m
 ORDER BY m.organization_id, m.instance_id, m.normalized_phone, m."timestamp" DESC;

INSERT INTO public.whatsapp_conversations(id, organization_id, instance_id, normalized_phone, created_at) VALUES
  ('${id('0f', 1)}', '${ORG}', '${A}', '${P.p1}', now() - interval '1 day'),
  ('${id('0f', 2)}', '${ORG}', '${A_OLD}', '${P.p2}', now() - interval '9 days');

-- Leitura: p1 lida entre a 1ª e a 2ª; p5 lida no CHIP ANTIGO depois da última
-- recebida; p4 marcada como não-lida (chave pela caixa). Para os dois usuários.
INSERT INTO public.conversation_read_state(organization_id, user_id, conversation_key, last_read_at, marked_unread)
SELECT '${ORG}', u, k, t, mk FROM (VALUES
  ('whatsapp:${A}:${P.p1}', now() - interval '6 minutes', false),
  ('whatsapp:${A_OLD}:${P.p5}', now() - interval '1 day', false),
  ('whatsapp:${A}:${P.p4}', now() - interval '25 days', true),
  ('whatsapp:${B}:${P.p6}', now() - interval '10 minutes', false)
) v(k, t, mk) CROSS JOIN (VALUES ('${U.adm}'::uuid), ('${U.mem}'::uuid)) us(u);
`;

// Forma de prod: recorte strict instalado e as 8 views private.* (sem recorte
// próprio aqui — a equivalência é o que se testa), mais os desvios que só
// existem em prod (JR Tex, Riofix) em forma neutra.
const PROD_SHAPE = `
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
CREATE FUNCTION private.strict_lead_member_orgs() RETURNS uuid[] LANGUAGE sql STABLE AS $$ SELECT '{}'::uuid[] $$;
-- Botões dos desvios: desligados por padrão; os testes e) ligam.
CREATE TABLE private.knobs (jrtex boolean NOT NULL DEFAULT false, pipelines uuid[] NOT NULL DEFAULT '{}', balcao uuid);
INSERT INTO private.knobs DEFAULT VALUES;
CREATE FUNCTION private.jrtex_pipeline_scoped() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT jrtex FROM private.knobs $$;
CREATE FUNCTION private.jrtex_visible_pipeline_ids() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT pipelines FROM private.knobs $$;
CREATE FUNCTION private.riofix_balcao_current_scope() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT balcao FROM private.knobs $$;
${RELS.map((r) => `CREATE VIEW private.${r} WITH (security_invoker = true) AS SELECT * FROM public.${r};`).join('\n')}
`;

const PROD_ACL = `
REVOKE ALL ON FUNCTION ${SIG} FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ${SIG} TO authenticated;
`;

async function db({ prodShape = true, restrict = false } = {}) {
  const pg = new PGlite();
  await pg.exec(SKELETON);
  if (prodShape) await pg.exec(PROD_SHAPE);
  if (restrict) await pg.exec(`UPDATE public.organizations SET chat_restrict_to_owner = true`);
  return pg;
}

async function call(pg, user, args = {}) {
  await pg.query(`SELECT set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ sub: user, role: 'authenticated' })]);
  await pg.exec('SET ROLE authenticated');
  try {
    const who = await pg.query('SELECT auth.uid() AS uid, current_user AS r');
    assert.equal(who.rows[0].uid, user, 'claims não chegaram');
    assert.equal(who.rows[0].r, 'authenticated');
    const r = await pg.query(
      `SELECT * FROM public.get_whatsapp_conversation_list_multi(
         p_org => $1, p_instances => $2::uuid[], p_limit => $3, p_before => $4::timestamptz,
         p_unread => $5, p_waiting => $6, p_include_groups => $7, p_before_box => $8::uuid, p_before_phone => $9)`,
      [ORG, args.instances ?? null, args.limit ?? 50, args.before ?? null, args.unread ?? null,
        args.waiting ?? null, args.groups ?? false, args.beforeBox ?? null, args.beforePhone ?? null],
    );
    return r.rows;
  } finally {
    await pg.exec('RESET ROLE');
    await pg.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

const SCENARIOS = {
  padrao: {},
  naoLidas: { unread: true },
  naoLidasComGrupos: { unread: true, groups: true },
  aguardando: { waiting: true },
  comGrupos: { groups: true },
  caixaUnica: { instances: [A] },
  limitePequeno: { limit: 3 },
};

async function snapshot(pg) {
  const out = {};
  for (const [who, user] of Object.entries(U)) {
    for (const [name, args] of Object.entries(SCENARIOS)) {
      out[`${who}/${name}`] = await call(pg, user, args);
    }
    // Página 2 pelo cursor composto da última linha da página 1 (limite 4:
    // a borda cai no empate p8/p9).
    const p1 = await call(pg, user, { limit: 4 });
    const last = p1.at(-1);
    out[`${who}/pagina2`] = await call(pg, user, {
      limit: 4, before: last.last_message_time, beforeBox: last.instance_id, beforePhone: last.normalized_phone,
    });
  }
  return out;
}

for (const restrict of [false, true]) {
  test(`a: mesma saída da função viva de prod (isolamento ${restrict ? 'ligado' : 'desligado'})`, async () => {
    const pg = await db({ restrict });
    await pg.exec(RB);
    await pg.exec(PROD_ACL);
    const antes = await snapshot(pg);
    await pg.exec(MIG);
    const depois = await snapshot(pg);
    for (const k of Object.keys(antes)) assert.deepEqual(depois[k], antes[k], `cenário ${k}`);

    // O conjunto exercita o que diz: sem isto a igualdade seria verde por vazio.
    const unread = Object.fromEntries(antes['adm/padrao'].map((r) => [`${r.instance_id}:${r.normalized_phone}`, r.unread_count]));
    assert.equal(unread[`${A}:${P.p1}`], 2, 'p1: lida no meio, 2 depois');
    assert.equal(unread[`${A}:${P.p2}`], 1, 'p2: chip antigo mapeado para a caixa A');
    assert.equal(unread[`${A}:${P.p4}`], 1, 'p4: marcada como não-lida');
    assert.equal(unread[`${A}:${P.p5}`], 0, 'p5: leitura no chip antigo vale');
    assert.equal(unread[`${A}:${P.p6}`], 1, 'p6 na A: leitura da B não zera a A');
    assert.equal(unread[`${B}:${P.p6}`], 0, 'p6 na B: lida na B');
    assert.equal(unread[`${A}:${P.p7}`], 0, 'p7: apagada não conta');
    const naoLidas = antes['adm/naoLidas'].map((r) => r.normalized_phone).sort();
    assert.deepEqual(naoLidas, [P.p1, P.p2, P.p4, P.p6, P.p8].sort(), 'filtro de não-lida');
    assert.ok(antes['adm/comGrupos'].some((r) => r.is_group), 'grupo aparece com p_include_groups');
    assert.ok(antes['adm/pagina2'].length > 0, 'página 2 não vazia');
    if (restrict) {
      // Membro com isolamento: só o lead dele (p1) e o lead sem dono (p6, nas
      // duas caixas, via leads.view_unassigned). Telefone sem lead some.
      const mem = antes['mem/padrao'].map((r) => r.normalized_phone).sort();
      assert.deepEqual(mem, [P.p1, P.p6, P.p6].sort(), 'isolamento por responsável recorta');
    }
  });
}

test('b: forma de prod — 8 relações em private.*, 24 ocorrências, marcadas na tabela, escopo JR Tex sem guarda', async () => {
  const pg = await db();
  await pg.exec(RB);
  await pg.exec(MIG);
  const def = (await pg.query(`SELECT pg_get_functiondef('${SIG}'::regprocedure) AS d`)).rows[0].d;
  const sobra = def.match(new RegExp(`public\\.(${RELS.join('|')})(?![A-Za-z0-9_])`, 'g')) ?? [];
  assert.deepEqual(sobra, [], 'nenhuma das 8 relações fica em public');
  assert.equal((def.match(/private\./g) ?? []).length, 24);
  assert.ok(!def.includes("to_regprocedure('private.jrtex_pipeline_scoped()')"), 'guarda do escopo JR Tex removida em prod');
  assert.ok(def.includes('IF true THEN'), 'escopo JR Tex roda sempre em prod');
  assert.ok(def.includes('FROM public."conversation_read_state" rs'), 'marcadas-não-lidas lê a TABELA');
  assert.ok(!/\bread_state AS\b/.test(def), 'CTE read_state não existe mais');
});

test('c: forma do repo — aplica sem trocar nada e a função roda', async () => {
  const pg = await db({ prodShape: false });
  await pg.exec(MIG);
  const def = (await pg.query(`SELECT pg_get_functiondef('${SIG}'::regprocedure) AS d`)).rows[0].d;
  // 17 referências às 8 relações, todas em public; nenhuma troca.
  assert.equal((def.match(new RegExp(`public\\.(${RELS.join('|')})(?![A-Za-z0-9_])`, 'g')) ?? []).length, 17);
  assert.ok(!/private\.(conversation_read_state|conversations|lead_tags|leads|pipeline_entries|whatsapp_)/.test(def),
    'sem strict instalado, nenhuma relação vai para private');
  const rows = await call(pg, U.adm, { unread: true });
  assert.deepEqual(rows.map((r) => r.normalized_phone).sort(), [P.p1, P.p2, P.p4, P.p6, P.p8].sort());
});

test('d: ACL igual à de prod', async () => {
  const pg = await db();
  await pg.exec(RB);
  await pg.exec(PROD_ACL);
  await pg.exec(MIG);
  const r = (await pg.query(`SELECT
      has_function_privilege('anon', '${SIG}', 'EXECUTE') AS anon,
      has_function_privilege('service_role', '${SIG}', 'EXECUTE') AS service_role,
      has_function_privilege('authenticated', '${SIG}', 'EXECUTE') AS authenticated`)).rows[0];
  assert.deepEqual(r, { anon: false, service_role: false, authenticated: true });
});

// e) caminhos verdadeiros dos desvios de prod, antiga × nova.
async function compararComDesvio(knobs, { restrict = false, cenarios }) {
  const pg = await db({ restrict });
  await pg.exec(knobs);
  await pg.exec(RB);
  await pg.exec(PROD_ACL);
  const antes = {};
  for (const [k, [user, args]] of Object.entries(cenarios)) antes[k] = await call(pg, user, args);
  await pg.exec(MIG);
  for (const [k, [user, args]] of Object.entries(cenarios)) {
    assert.deepEqual(await call(pg, user, args), antes[k], `cenário ${k}`);
  }
  return antes;
}

test('e1: escopo de funil JR Tex ligado — mesma saída, só lead em funil visível', async () => {
  const antes = await compararComDesvio(
    `UPDATE private.knobs SET jrtex = true, pipelines = ARRAY['${PIPE.visivel}']::uuid[]`,
    { cenarios: {
      adm: [U.adm, {}], mem: [U.mem, {}], admNaoLidas: [U.adm, { unread: true }], admGrupos: [U.adm, { groups: true }],
    } },
  );
  // Só p1 (L1, funil visível). p6 (L2, funil oculto) e telefones sem lead somem.
  assert.deepEqual(antes.adm.map((r) => r.normalized_phone), [P.p1]);
  assert.deepEqual(antes.mem.map((r) => r.normalized_phone), [P.p1]);
});

test('e2: balcão Riofix com isolamento ligado — mesma saída, bypass do isolamento', async () => {
  const antes = await compararComDesvio(
    `UPDATE private.knobs SET balcao = '${id('09', 9)}'`,
    { restrict: true, cenarios: { mem: [U.mem, {}], memNaoLidas: [U.mem, { unread: true }] } },
  );
  // Sem o balcão, o membro só veria p1 e p6 (teste a). Com ele, vê telefone sem lead.
  assert.ok(antes.mem.some((r) => r.normalized_phone === P.p2), 'balcão faz bypass do isolamento');
});

test('f: forma de prod sem função de desvio — apply aborta (falha fechada)', async () => {
  for (const fn of ['jrtex_pipeline_scoped()', 'jrtex_visible_pipeline_ids()', 'riofix_balcao_current_scope()']) {
    const pg = await db();
    await pg.exec(RB);
    await pg.exec(`DROP FUNCTION private.${fn}`);
    const antes = (await pg.query(`SELECT prosrc FROM pg_proc WHERE oid = '${SIG}'::regprocedure`)).rows[0].prosrc;
    await assert.rejects(pg.exec(`BEGIN;\n${MIG}\nCOMMIT;`), new RegExp(`faltam .*private\\.${fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    await pg.exec('ROLLBACK');
    const depois = (await pg.query(`SELECT prosrc FROM pg_proc WHERE oid = '${SIG}'::regprocedure`)).rows[0].prosrc;
    assert.equal(depois, antes, `sem ${fn}: a função de antes fica intacta`);
  }
});

test('g: gate de org — usuário de outra org recebe 42501 nas duas versões', async () => {
  const pg = await db();
  await pg.exec(RB);
  await pg.exec(PROD_ACL);
  await assert.rejects(call(pg, U_FORA), (e) => e.code === '42501');
  await pg.exec(MIG);
  await assert.rejects(call(pg, U_FORA), (e) => e.code === '42501');
});
