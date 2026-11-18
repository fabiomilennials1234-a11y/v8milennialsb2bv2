// get_conversations_awaiting_human_reply_multi sem varredura da janela
// (20280119020000_aguardando_resposta_sem_varredura_da_janela.sql) e o
// autovacuum por inserção de whatsapp_messages (20280119030000).
//
// Provado aqui, como `authenticated` COM claims:
//   a. equivalência: a função viva de prod (o rollback, md5 conferido) e a
//      nova devolvem exatamente as mesmas linhas, na mesma ordem, em
//      7 cenários × 2 usuários × recorte strict ligado/desligado × isolamento
//      por responsável ligado/desligado — com um recorte strict DE VERDADE
//      nas views (por lead/telefone), sobre um conjunto que exercita: chip
//      com uuid histórico (reap_queue), resposta humana × resposta da IA,
//      janela de 7 e de 30 dias, recebida apagada, grupo, thread arquivada,
//      telefone nas duas caixas, empate de last_in, e o caso que separa os
//      dois algoritmos: um telefone com DOIS leads, a recebida mais nova num
//      lead que o membro não vê e uma mais velha num que ele vê;
//   b. balcão Riofix ligado: mesma saída e bypass do isolamento;
//   c. forma de prod: 4 relações em private.*, leituras de candidatos entre
//      aspas intactas, guarda do balcão trocada por `true`; falha FECHADA sem
//      a função do balcão; forma do repo aplica e roda;
//   d. ACL igual à de prod; gate de org 42501 nas duas versões;
//   e. autovacuum: reloptions aplicadas e o rollback devolve as de prod.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MIG = read('../../supabase/migrations/20280119020000_aguardando_resposta_sem_varredura_da_janela.sql');
const RB = read('../../supabase/migrations/rollback/20280119020000_aguardando_resposta_sem_varredura_da_janela.sql');
const VAC = read('../../supabase/migrations/20280119030000_whatsapp_messages_autovacuum_por_insercao.sql');
const VAC_RB = read('../../supabase/migrations/rollback/20280119030000_whatsapp_messages_autovacuum_por_insercao.sql');

const SIG = 'public.get_conversations_awaiting_human_reply_multi(uuid,uuid[],integer,integer)';
const RELS = ['leads', 'whatsapp_conversation_summary', 'whatsapp_conversations', 'whatsapp_messages'];

const id = (p, n) => `${p}000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`;
const ORG = id('0a', 1);
const ORG2 = id('0a', 2);
const U = { adm: id('0b', 1), mem: id('0b', 2) };
const U_FORA = id('0b', 9);
const TM = { adm: id('0c', 1), mem: id('0c', 2) };
const A = id('0d', 1), A_OLD = id('0d', 2), B = id('0d', 3);
const P = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`p${i + 1}`, `55489000000${String(i + 1).padStart(2, '0')}`]));
P.g1 = '120363000000000001';
const L = { mem: id('0e', 1), adm: id('0e', 2), semDono: id('0e', 3), p10mem: id('0e', 4), p10adm: id('0e', 5), p13: id('0e', 6) };

const SKELETON = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.organizations (id uuid PRIMARY KEY, chat_restrict_to_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.team_members (id uuid PRIMARY KEY, user_id uuid, organization_id uuid,
  is_active boolean NOT NULL DEFAULT true, role text NOT NULL DEFAULT 'member', name text);
CREATE TABLE public.master_users (user_id uuid, is_active boolean);
CREATE TABLE public.member_feature_permissions (team_member_id uuid, feature_key text, enabled boolean);
CREATE TABLE public.leads (id uuid PRIMARY KEY, organization_id uuid, normalized_phone text, deleted_at timestamptz,
  pre_sale_responsible_id uuid, sale_responsible_id uuid, sdr_id uuid, closer_id uuid);
CREATE TABLE public.lead_owners (lead_id uuid, organization_id uuid, team_member_id uuid, role text);
CREATE TABLE public.whatsapp_instances (id uuid PRIMARY KEY, organization_id uuid, phone_number text);
CREATE TABLE public.whatsapp_instance_reap_queue (instance_id uuid, organization_id uuid, phone_number text);
CREATE TABLE public.whatsapp_conversations (id uuid PRIMARY KEY, organization_id uuid, instance_id uuid,
  normalized_phone text, archived_at timestamptz, deleted_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.whatsapp_conversation_summary (organization_id uuid, instance_id uuid, normalized_phone text,
  phone_number text, last_push_name text, last_message_time timestamptz, lead_id uuid,
  PRIMARY KEY (organization_id, instance_id, normalized_phone));
CREATE TABLE public.whatsapp_messages (organization_id uuid, instance_id uuid, normalized_phone text, lead_id uuid,
  direction text, deleted_at timestamptz, is_group boolean NOT NULL DEFAULT false, "timestamp" timestamptz,
  content text, sent_source text, push_name text);
CREATE INDEX ON public.whatsapp_messages (organization_id, normalized_phone, instance_id, "timestamp" DESC);

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
-- Regra de prod de whatsapp_chip_instance_ids (a função antiga a chama por caixa).
CREATE FUNCTION public.whatsapp_chip_instance_ids(p_org uuid, p_instance uuid) RETURNS uuid[]
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_digits text; v_ids uuid[];
BEGIN
  IF NOT COALESCE(p_instance = ANY(public.whatsapp_readable_instance_ids(p_org, ARRAY[p_instance])), false) THEN
    RETURN ARRAY[]::uuid[];
  END IF;
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
CREATE FUNCTION public.my_team_member_id(p_org uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public' AS $$
  SELECT id FROM public.team_members WHERE user_id = auth.uid() AND organization_id = p_org AND is_active LIMIT 1 $$;
CREATE FUNCTION public.rls_lead_co_owned(p_lead uuid, p_tms uuid[]) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.lead_owners o WHERE o.lead_id = p_lead AND o.role = 'co'
   AND o.team_member_id = ANY(p_tms)) $$;

INSERT INTO public.organizations(id) VALUES ('${ORG}'), ('${ORG2}');
INSERT INTO public.team_members(id, user_id, organization_id, role, name) VALUES
  ('${TM.adm}', '${U.adm}', '${ORG}', 'admin', 'Admin'),
  ('${TM.mem}', '${U.mem}', '${ORG}', 'member', 'Membro'),
  ('${id('0c', 9)}', '${U_FORA}', '${ORG2}', 'admin', 'Fora');
INSERT INTO public.member_feature_permissions VALUES ('${TM.mem}', 'leads.view_unassigned', true);
INSERT INTO public.whatsapp_instances VALUES ('${A}', '${ORG}', '+55 (48) 99999-0001'), ('${B}', '${ORG}', '5548999990002');
INSERT INTO public.whatsapp_instance_reap_queue VALUES ('${A_OLD}', '${ORG}', '5548999990001');
INSERT INTO public.leads(id, organization_id, normalized_phone, sale_responsible_id) VALUES
  ('${L.mem}', '${ORG}', '${P.p1}', '${TM.mem}'),
  ('${L.adm}', '${ORG}', '${P.p4}', '${TM.adm}'),
  ('${L.semDono}', '${ORG}', '${P.p6}', NULL),
  ('${L.p10mem}', '${ORG}', '${P.p10}', '${TM.mem}'),
  ('${L.p10adm}', '${ORG}', '${P.p10}', '${TM.adm}'),
  ('${L.p13}', '${ORG}', '${P.p13}', '${TM.mem}');

INSERT INTO public.whatsapp_messages
  (organization_id, instance_id, normalized_phone, lead_id, direction, deleted_at, is_group, "timestamp", content, sent_source, push_name) VALUES
  -- p1: esperando, lead do membro
  ('${ORG}', '${A}', '${P.p1}', '${L.mem}', 'incoming', NULL, false, now() - interval '10 minutes', 'p1', NULL, 'Um'),
  -- p2: chip ANTIGO da caixa A
  ('${ORG}', '${A_OLD}', '${P.p2}', NULL, 'incoming', NULL, false, now() - interval '2 hours', 'p2', NULL, 'Dois'),
  -- p3: humano respondeu depois
  ('${ORG}', '${A}', '${P.p3}', NULL, 'incoming', NULL, false, now() - interval '1 hour', 'p3', NULL, 'Tres'),
  ('${ORG}', '${A}', '${P.p3}', NULL, 'outgoing', NULL, false, now() - interval '30 minutes', 'r3', 'manual', NULL),
  -- p4: IA respondeu depois (segue esperando, ai_replied)
  ('${ORG}', '${A}', '${P.p4}', '${L.adm}', 'incoming', NULL, false, now() - interval '50 minutes', 'p4', NULL, 'Quatro'),
  ('${ORG}', '${A}', '${P.p4}', '${L.adm}', 'outgoing', NULL, false, now() - interval '40 minutes', 'ia4', 'copilot', NULL),
  -- p5: fora dos 7 dias, dentro dos 30
  ('${ORG}', '${A}', '${P.p5}', NULL, 'incoming', NULL, false, now() - interval '10 days', 'p5', NULL, 'Cinco'),
  -- p6: nas duas caixas
  ('${ORG}', '${A}', '${P.p6}', '${L.semDono}', 'incoming', NULL, false, now() - interval '25 minutes', 'p6a', NULL, 'Seis'),
  ('${ORG}', '${B}', '${P.p6}', '${L.semDono}', 'incoming', NULL, false, now() - interval '15 minutes', 'p6b', NULL, 'Seis'),
  -- p7: a mais nova está apagada
  ('${ORG}', '${A}', '${P.p7}', NULL, 'incoming', now(), false, now() - interval '5 minutes', 'apagada', NULL, 'Sete'),
  ('${ORG}', '${A}', '${P.p7}', NULL, 'incoming', NULL, false, now() - interval '3 hours', 'p7', NULL, 'Sete'),
  -- p8 e p9: empate de last_in (desempate por caixa, telefone)
  ('${ORG}', '${A}', '${P.p8}', NULL, 'incoming', NULL, false, date_trunc('hour', now()) - interval '5 hours', 'p8', NULL, 'Oito'),
  ('${ORG}', '${A}', '${P.p9}', NULL, 'incoming', NULL, false, date_trunc('hour', now()) - interval '5 hours', 'p9', NULL, 'Nove'),
  -- p10: DOIS leads no telefone. A recebida mais nova é do lead do admin (o
  -- membro com strict não a vê); a mais velha é do lead do membro, e a
  -- resposta humana fica ENTRE as duas → admin: esperando; membro: não.
  ('${ORG}', '${A}', '${P.p10}', '${L.p10mem}', 'incoming', NULL, false, now() - interval '20 minutes', 'p10 velha', NULL, 'Dez'),
  ('${ORG}', '${A}', '${P.p10}', '${L.p10mem}', 'outgoing', NULL, false, now() - interval '15 minutes', 'r10', 'manual', NULL),
  ('${ORG}', '${A}', '${P.p10}', '${L.p10adm}', 'incoming', NULL, false, now() - interval '5 minutes', 'p10 nova', NULL, 'Dez'),
  -- p11: thread arquivada
  ('${ORG}', '${A}', '${P.p11}', NULL, 'incoming', NULL, false, now() - interval '7 minutes', 'p11', NULL, 'Onze'),
  -- p12: grupo-like, mas com is_group (fora)
  ('${ORG}', '${A}', '${P.g1}', NULL, 'incoming', NULL, true, now() - interval '3 minutes', 'g', NULL, 'Grupo'),
  -- p13: lead_id NULL na mensagem, telefone do lead do membro
  ('${ORG}', '${B}', '${P.p13}', NULL, 'incoming', NULL, false, now() - interval '35 minutes', 'p13', NULL, 'Treze'),
  -- outra org, mesmo telefone
  ('${ORG2}', '${A}', '${P.p1}', NULL, 'incoming', NULL, false, now(), 'fora', NULL, 'Fora');

-- Resumo derivado das mensagens como o trigger faz (greatest por chip+telefone).
INSERT INTO public.whatsapp_conversation_summary
SELECT DISTINCT ON (m.organization_id, m.instance_id, m.normalized_phone)
       m.organization_id, m.instance_id, m.normalized_phone, '+' || m.normalized_phone, m.push_name,
       m."timestamp", m.lead_id
  FROM public.whatsapp_messages m
 ORDER BY m.organization_id, m.instance_id, m.normalized_phone, m."timestamp" DESC;

INSERT INTO public.whatsapp_conversations(id, organization_id, instance_id, normalized_phone, archived_at, created_at) VALUES
  ('${id('0f', 1)}', '${ORG}', '${A}', '${P.p1}', NULL, now() - interval '1 day'),
  ('${id('0f', 2)}', '${ORG}', '${A_OLD}', '${P.p2}', NULL, now() - interval '9 days'),
  ('${id('0f', 3)}', '${ORG}', '${A}', '${P.p11}', now(), now() - interval '2 days');
`;

// Forma de prod: as 4 relações como views private.* com um recorte strict de
// VERDADE (botão `strict`): para o MEMBRO, mensagem/resumo/conversa só são
// visíveis se o lead dela (ou, sem lead, um lead do telefone) é dele; lead só
// é visível se é dele. Mesmo formato do predicado de prod: depende só de
// (org, chip, lead, telefone).
const PROD_SHAPE = `
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
CREATE TABLE private.knobs (strict boolean NOT NULL DEFAULT false, balcao uuid);
INSERT INTO private.knobs DEFAULT VALUES;
GRANT SELECT ON private.knobs TO authenticated;
CREATE FUNCTION private.strict_lead_member_orgs() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT CASE WHEN (SELECT strict FROM private.knobs) AND EXISTS (SELECT 1 FROM public.team_members
    WHERE user_id = auth.uid() AND organization_id = '${ORG}' AND role <> 'admin') THEN ARRAY['${ORG}'::uuid] ELSE '{}' END $$;
CREATE FUNCTION private.dono(p_lead uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.leads l JOIN public.team_members tm ON tm.id = l.sale_responsible_id
                  WHERE l.id = p_lead AND tm.user_id = auth.uid()) $$;
CREATE FUNCTION private.strict_phone_visible(p_org uuid, p_lead uuid, p_phone text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT NOT (p_org = ANY((SELECT private.strict_lead_member_orgs())::uuid[]))
      OR EXISTS (SELECT 1 FROM public.leads l WHERE l.organization_id = p_org
                   AND ((p_lead IS NOT NULL AND l.id = p_lead) OR (p_lead IS NULL AND l.normalized_phone = p_phone))
                   AND private.dono(l.id)) $$;
CREATE FUNCTION private.riofix_balcao_current_scope() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT balcao FROM private.knobs $$;
CREATE VIEW private.whatsapp_messages WITH (security_invoker = true) AS
  SELECT * FROM public.whatsapp_messages m
   WHERE NOT (m.organization_id = ANY((SELECT private.strict_lead_member_orgs())::uuid[]))
      OR private.strict_phone_visible(m.organization_id, m.lead_id, m.normalized_phone);
CREATE VIEW private.whatsapp_conversation_summary WITH (security_invoker = true) AS
  SELECT * FROM public.whatsapp_conversation_summary s
   WHERE NOT (s.organization_id = ANY((SELECT private.strict_lead_member_orgs())::uuid[]))
      OR private.strict_phone_visible(s.organization_id, s.lead_id, s.normalized_phone);
CREATE VIEW private.whatsapp_conversations WITH (security_invoker = true) AS
  SELECT * FROM public.whatsapp_conversations c
   WHERE NOT (c.organization_id = ANY((SELECT private.strict_lead_member_orgs())::uuid[]))
      OR private.strict_phone_visible(c.organization_id, NULL, c.normalized_phone);
CREATE VIEW private.leads WITH (security_invoker = true) AS
  SELECT * FROM public.leads l
   WHERE NOT (l.organization_id = ANY((SELECT private.strict_lead_member_orgs())::uuid[]))
      OR private.dono(l.id);
GRANT SELECT ON public.whatsapp_messages, public.whatsapp_conversation_summary, public.whatsapp_conversations,
  public.leads TO authenticated;
`;

const PROD_ACL = `
REVOKE ALL ON FUNCTION ${SIG} FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ${SIG} TO authenticated;
`;

async function db({ prodShape = true, strict = false, restrict = false } = {}) {
  const pg = new PGlite();
  await pg.exec(SKELETON);
  if (prodShape) await pg.exec(PROD_SHAPE);
  if (strict) await pg.exec('UPDATE private.knobs SET strict = true');
  if (restrict) await pg.exec('UPDATE public.organizations SET chat_restrict_to_owner = true');
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
      `SELECT * FROM public.get_conversations_awaiting_human_reply_multi(
         p_org => $1, p_instances => $2::uuid[], p_limit => $3, p_window_days => $4)`,
      [ORG, args.instances ?? null, args.limit ?? 30, args.days ?? 7],
    );
    return r.rows;
  } finally {
    await pg.exec('RESET ROLE');
    await pg.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

const SCENARIOS = {
  padrao: {},
  janela30: { days: 30 },
  janela1: { days: 1 },
  limite2: { limit: 2 },
  caixaA: { instances: [A] },
  caixaB: { instances: [B] },
  chipAntigoPedido: { instances: [A_OLD] },
};

async function snapshot(pg) {
  const out = {};
  for (const [who, user] of Object.entries(U)) {
    for (const [name, args] of Object.entries(SCENARIOS)) out[`${who}/${name}`] = await call(pg, user, args);
  }
  return out;
}

const fones = (rows) => rows.map((r) => `${r.instance_id === A ? 'A' : r.instance_id === B ? 'B' : '?'}:${r.normalized_phone}`);

for (const strict of [false, true]) {
  for (const restrict of [false, true]) {
    test(`a: mesma saída da função viva (strict ${strict ? 'on' : 'off'}, isolamento ${restrict ? 'on' : 'off'})`, async () => {
      const pg = await db({ strict, restrict });
      await pg.exec(RB);
      await pg.exec(PROD_ACL);
      const antes = await snapshot(pg);
      await pg.exec(MIG);
      const depois = await snapshot(pg);
      for (const k of Object.keys(antes)) assert.deepEqual(depois[k], antes[k], `cenário ${k}`);

      // O conjunto exercita o que diz.
      const adm = antes['adm/padrao'];
      const a = Object.fromEntries(adm.map((r) => [`${r.instance_id}:${r.normalized_phone}`, r]));
      assert.ok(a[`${A}:${P.p2}`], 'p2: chip antigo mapeado para a caixa A');
      assert.ok(!a[`${A}:${P.p3}`], 'p3: humano respondeu');
      assert.equal(a[`${A}:${P.p4}`]?.ai_replied, true, 'p4: IA respondeu, segue esperando');
      assert.ok(!a[`${A}:${P.p5}`], 'p5: fora dos 7 dias');
      assert.ok(antes['adm/janela30'].some((r) => r.normalized_phone === P.p5), 'p5 na janela de 30');
      assert.ok(a[`${A}:${P.p6}`] && a[`${B}:${P.p6}`], 'p6 nas duas caixas');
      assert.equal(a[`${A}:${P.p7}`]?.last_client_message, 'p7', 'p7: a apagada não conta');
      assert.ok(a[`${A}:${P.p10}`], 'p10: admin vê a recebida mais nova → esperando');
      assert.ok(!a[`${A}:${P.p11}`], 'p11: arquivada');
      assert.ok(!adm.some((r) => r.normalized_phone === P.g1), 'grupo fora');
      assert.equal(adm[0].waiting_total, adm.length, 'waiting_total = linhas sem LIMIT');
      assert.equal(antes['adm/limite2'].length, 2);
      assert.equal(antes['adm/limite2'][0].waiting_total, adm.length, 'total conta antes do LIMIT');
      const i8 = adm.findIndex((r) => r.normalized_phone === P.p8);
      assert.equal(adm[i8 + 1]?.normalized_phone, P.p9, 'empate p8/p9 desempatado por telefone');
      if (strict) {
        const mem = fones(antes['mem/padrao']);
        assert.ok(!mem.includes(`A:${P.p10}`), 'p10, membro strict: a recebida visível é a velha, e o humano respondeu depois dela');
        assert.ok(mem.includes(`A:${P.p1}`), 'p1: lead do membro');
        assert.ok(mem.includes(`B:${P.p13}`), 'p13: mensagem sem lead, telefone do lead do membro');
        assert.ok(!mem.includes(`A:${P.p4}`), 'p4: lead do admin some');
      }
    });
  }
}

test('b: balcão Riofix com isolamento ligado — mesma saída, bypass do isolamento', async () => {
  const pg = await db({ restrict: true });
  await pg.exec(`UPDATE private.knobs SET balcao = '${id('09', 9)}'`);
  await pg.exec(RB);
  const antes = await call(pg, U.mem);
  await pg.exec(MIG);
  assert.deepEqual(await call(pg, U.mem), antes);
  assert.ok(antes.some((r) => r.normalized_phone === P.p2), 'telefone sem lead aparece: bypass');
});

test('c: forma de prod, falha fechada sem o balcão, forma do repo', async () => {
  const pg = await db();
  await pg.exec(RB);
  await pg.exec(MIG);
  const def = (await pg.query(`SELECT pg_get_functiondef('${SIG}'::regprocedure) AS d`)).rows[0].d;
  const sobra = def.match(new RegExp(`public\\.(${RELS.join('|')})(?![A-Za-z0-9_"])`, 'g')) ?? [];
  assert.deepEqual(sobra, [], 'nenhuma relação do recorte em public.* sem aspas');
  assert.equal((def.match(/public\."whatsapp_messages"/g) ?? []).length, 1, 'candidatos strict na tabela');
  assert.equal((def.match(/public\."whatsapp_conversation_summary"/g) ?? []).length, 1, 'candidatos pelo resumo na tabela');
  assert.ok(!def.includes("to_regprocedure('private.riofix_balcao_current_scope()')"), 'guarda do balcão trocada');
  assert.ok(def.includes('IF true THEN'));
  assert.ok(def.includes("to_regprocedure('private.strict_lead_member_orgs()')"), 'escolha do caminho segue guardada');

  const sem = await db();
  await sem.exec(RB);
  await sem.exec('DROP FUNCTION private.riofix_balcao_current_scope()');
  const antes = (await sem.query(`SELECT prosrc FROM pg_proc WHERE oid = '${SIG}'::regprocedure`)).rows[0].prosrc;
  await assert.rejects(sem.exec(`BEGIN;\n${MIG}\nCOMMIT;`), /falta private\.riofix_balcao_current_scope/);
  await sem.exec('ROLLBACK');
  assert.equal((await sem.query(`SELECT prosrc FROM pg_proc WHERE oid = '${SIG}'::regprocedure`)).rows[0].prosrc, antes);

  const repo = await db({ prodShape: false });
  await repo.exec(MIG);
  const d2 = (await repo.query(`SELECT pg_get_functiondef('${SIG}'::regprocedure) AS d`)).rows[0].d;
  assert.ok(!/private\.(leads|whatsapp_)/.test(d2), 'sem recorte instalado, nada vai para private');
  const rows = await call(repo, U.adm);
  assert.ok(rows.some((r) => r.normalized_phone === P.p1));
});

test('d: ACL igual à de prod; gate de org 42501 nas duas versões', async () => {
  const pg = await db();
  await pg.exec(RB);
  await pg.exec(PROD_ACL);
  await assert.rejects(call(pg, U_FORA), (e) => e.code === '42501');
  await pg.exec(MIG);
  await assert.rejects(call(pg, U_FORA), (e) => e.code === '42501');
  const r = (await pg.query(`SELECT
      has_function_privilege('anon', '${SIG}', 'EXECUTE') AS anon,
      has_function_privilege('service_role', '${SIG}', 'EXECUTE') AS service_role,
      has_function_privilege('authenticated', '${SIG}', 'EXECUTE') AS authenticated`)).rows[0];
  assert.deepEqual(r, { anon: false, service_role: false, authenticated: true });
});

test('e: autovacuum por inserção — aplica e o rollback devolve as reloptions de prod', async () => {
  const pg = await db({ prodShape: false });
  await pg.exec(`ALTER TABLE public.whatsapp_messages SET (autovacuum_vacuum_scale_factor = 0.10,
    autovacuum_analyze_scale_factor = 0.10, fillfactor = 85, toast_tuple_target = 1024)`);
  const opts = async () => (await pg.query(
    `SELECT reloptions FROM pg_class WHERE oid = 'public.whatsapp_messages'::regclass`)).rows[0].reloptions.sort();
  const prod = await opts();
  await pg.exec(VAC);
  assert.deepEqual(await opts(), [
    'autovacuum_analyze_scale_factor=0.10', 'autovacuum_vacuum_insert_scale_factor=0',
    'autovacuum_vacuum_insert_threshold=20000', 'autovacuum_vacuum_scale_factor=0.02',
    'fillfactor=85', 'toast_tuple_target=1024',
  ]);
  await pg.exec(VAC_RB);
  assert.deepEqual(await opts(), prod);
});
