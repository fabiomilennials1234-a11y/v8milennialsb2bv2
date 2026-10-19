// get_whatsapp_conversation_list_multi devolve as etiquetas da linha
// (20271128000000_etiquetas_na_lista_multi.sql).
//
// A lista multi do /chat fazia a RPC + 2 idas de fan-out (lead_tags e
// whatsapp_conversation_tags) por refetch. A migration traz as etiquetas numa
// coluna `tags jsonb` no fim do retorno. A RPC é SECURITY DEFINER: a RLS das três
// tabelas de etiqueta NÃO se aplica dentro dela, então a visibilidade tem de ser
// espelhada no corpo — inclusive o recorte RESTRICTIVE de strict_lead_owner_access,
// que em prod vive nas views `private.leads` / `private.lead_tags`.
//
// Provado aqui, como `authenticated` COM claims (auth.uid() conferido em cada
// chamada — SET ROLE sem claims daria lista vazia e verde falso):
//   a. etiquetas do lead + da conversa, dedupe mantendo a do lead, ordem
//      lead→conversa e nome,id dentro de cada origem;
//   b. conversa sem lead e sem etiqueta → '[]' (nunca NULL);
//   c. lead apagado → sem etiqueta do lead;
//   d. etiqueta de outra org não vaza (nem por lead, nem por conversa);
//   e. org com strict_lead_owner_access: membro não-dono não vê a etiqueta do lead,
//      dono e admin veem — com as views/funções `private.*` na forma de prod;
//   f. ACL: só authenticated (+ owner) executa; anon/service_role/PUBLIC não;
//   g. assinatura, demais colunas e linhas idênticas a 20271125; p_tags filtra;
//      o corpo novo é o de 20271125 + só o LATERAL de etiquetas;
//   h. rollback devolve a função de 20271125 com a mesma ACL;
//   i. forma de prod: com o strict instalado e as 8 views `private.*`, o corpo
//      passa a lê-las (como o de prod hoje), com 15 `private.` (rollback: 13) e,
//      normalizado, é o mesmo do repo;
//   j. falha FECHADA: strict instalado e uma das 8 views faltando → o apply
//      aborta e a função de antes fica intacta;
//   k. lista FECHADA: uma view `private.team_members` presente NÃO é trocada —
//      o gate e o isolamento ficam em public, seja qual for o catálogo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MIG = read('../../supabase/migrations/20271128000000_etiquetas_na_lista_multi.sql');
const RB = read('../../supabase/migrations/rollback/20271128000000_etiquetas_na_lista_multi.sql');
const BASE = read('../../supabase/migrations/20271125000000_co_donos_na_conversa.sql');

// A função de 20271125, sozinha: é o estado de prod antes desta migration.
const BASE_FN = (() => {
  const start = BASE.indexOf('CREATE OR REPLACE FUNCTION public.get_whatsapp_conversation_list_multi');
  const end = BASE.indexOf('$function$;', start) + '$function$;'.length;
  return BASE.slice(start, end);
})();
const bodyOf = (fnText) => {
  const i = fnText.indexOf('AS $function$') + 'AS $function$'.length;
  return fnText.slice(i, fnText.indexOf('$function$;', i));
};
const md5 = (s) => createHash('md5').update(s).digest('hex');
const normalize = (s) => s.replace(/\r/g, '').split('private.').join('public.');

// md5 do prosrc de prod (19/10), normalizado CRLF e private.→public.
const PROD_PROSRC_MD5 = 'e64b92853f014f492034042477f0fd0a';

const SIG = 'public.get_whatsapp_conversation_list_multi(uuid,uuid[],integer,timestamp with time zone,uuid[],text[],uuid[],text[],uuid,boolean,text,boolean,boolean,boolean,text,boolean,uuid,text)';

const id = (p, n) => `${p}000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`;
const ORG_A = id('0a', 1), ORG_B = id('0a', 2);
const U = { a1: id('0b', 1), a2: id('0b', 2), adm: id('0b', 3), b: id('0b', 4), master: id('0b', 5) };
const TM = { a1: id('0c', 1), a2: id('0c', 2), adm: id('0c', 3), b: id('0c', 4) };
const BOX_A = id('0d', 1), BOX_B = id('0d', 2);
const L1 = id('0e', 1), L_DEL = id('0e', 2), LB = id('0e', 3);
const C1 = id('0f', 1), C_B = id('0f', 2);
const T = { alfa: id('01', 1), meio: id('01', 2), zeta: id('01', 3), conv: id('01', 4), outra: id('01', 5), bTag: id('01', 6) };
const P1 = '5548900000001', P2 = '5548900000002', P3 = '5548900000003', PB = '5548900000009';

const SKELETON = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
-- Default privileges do Supabase: função nova em public nasce executável por
-- anon/authenticated/service_role POR NOME (além do PUBLIC do Postgres).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.organizations (id uuid PRIMARY KEY, chat_restrict_to_owner boolean NOT NULL DEFAULT false,
  feature_flags jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.team_members (id uuid PRIMARY KEY, user_id uuid, organization_id uuid,
  is_active boolean NOT NULL DEFAULT true, role text NOT NULL DEFAULT 'member');
CREATE TABLE public.master_users (user_id uuid, is_active boolean);
CREATE TABLE public.member_feature_permissions (team_member_id uuid, feature_key text, enabled boolean);
CREATE TABLE public.leads (id uuid PRIMARY KEY, organization_id uuid, normalized_phone text, deleted_at timestamptz,
  pre_sale_responsible_id uuid, sale_responsible_id uuid, sdr_id uuid, closer_id uuid, responsible_id uuid,
  qualification_tier text);
CREATE TABLE public.lead_owners (lead_id uuid, organization_id uuid, team_member_id uuid, role text);
CREATE TABLE public.pipeline_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, lead_id uuid,
  pipeline_id uuid, stage_key text, assigned_to uuid, metadata jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.conversations (organization_id uuid, lead_id uuid, state text);
CREATE TABLE public.conversation_read_state (organization_id uuid, user_id uuid, conversation_key text, last_read_at timestamptz);
CREATE TABLE public.whatsapp_instances (id uuid PRIMARY KEY, organization_id uuid);
CREATE TABLE public.whatsapp_conversations (id uuid PRIMARY KEY, organization_id uuid, instance_id uuid,
  normalized_phone text, archived_at timestamptz, deleted_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.whatsapp_conversation_summary (organization_id uuid, instance_id uuid, normalized_phone text,
  phone_number text, last_push_name text, last_message text, last_message_time timestamptz,
  last_message_direction text, last_message_sent_source text, lead_id uuid, is_group boolean NOT NULL DEFAULT false,
  PRIMARY KEY (organization_id, instance_id, normalized_phone));
CREATE TABLE public.whatsapp_messages (organization_id uuid, instance_id uuid, normalized_phone text, direction text,
  deleted_at timestamptz, is_group boolean NOT NULL DEFAULT false, "timestamp" timestamptz);
CREATE TABLE public.tags (id uuid PRIMARY KEY, organization_id uuid NOT NULL, name text NOT NULL, color text);
CREATE TABLE public.lead_tags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid, tag_id uuid,
  created_at timestamptz DEFAULT now(), UNIQUE (lead_id, tag_id));
CREATE TABLE public.whatsapp_conversation_tags (conversation_id uuid, tag_id uuid, UNIQUE (conversation_id, tag_id));

-- prod, verbatim
CREATE FUNCTION public.is_master_user(_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.master_users WHERE user_id = _user_id AND is_active = true);
END;
$function$;
-- simplificadas: a fronteira de org e de caixa não é o que este arquivo testa
CREATE FUNCTION public.get_my_organization_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public' AS $$
  SELECT organization_id FROM public.team_members WHERE user_id = auth.uid() AND is_active $$;
CREATE FUNCTION public.whatsapp_readable_instance_ids(p_org uuid, p_instances uuid[]) RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(array_agg(wi.id ORDER BY wi.id), '{}') FROM public.whatsapp_instances wi
   WHERE wi.organization_id = p_org AND (p_instances IS NULL OR wi.id = ANY(p_instances)) $$;
CREATE FUNCTION public.whatsapp_chip_instance_ids(p_org uuid, p_box uuid) RETURNS uuid[]
  LANGUAGE sql STABLE AS $$ SELECT ARRAY[p_box] $$;
CREATE FUNCTION public.is_org_admin(p_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public' AS $$
  SELECT COALESCE(public.is_master_user(), false) OR EXISTS (SELECT 1 FROM public.team_members
   WHERE user_id = auth.uid() AND organization_id = p_org AND role = 'admin' AND is_active) $$;
CREATE FUNCTION public.rls_lead_co_owned(p_lead uuid, p_tms uuid[]) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.lead_owners o WHERE o.lead_id = p_lead AND o.role = 'co'
   AND o.team_member_id = ANY(p_tms)) $$;
CREATE FUNCTION public.is_conversation_marked_unread(p_org uuid, p_box uuid, p_phone text) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT false $$;

INSERT INTO public.organizations(id) VALUES ('${ORG_A}'), ('${ORG_B}');
INSERT INTO public.team_members(id, user_id, organization_id, role) VALUES
  ('${TM.a1}', '${U.a1}', '${ORG_A}', 'member'),
  ('${TM.a2}', '${U.a2}', '${ORG_A}', 'member'),
  ('${TM.adm}', '${U.adm}', '${ORG_A}', 'admin'),
  ('${TM.b}', '${U.b}', '${ORG_B}', 'member');
INSERT INTO public.master_users VALUES ('${U.master}', true);
INSERT INTO public.whatsapp_instances VALUES ('${BOX_A}', '${ORG_A}'), ('${BOX_B}', '${ORG_B}');
INSERT INTO public.leads(id, organization_id, normalized_phone, deleted_at, sale_responsible_id) VALUES
  ('${L1}', '${ORG_A}', '${P1}', NULL, '${TM.a2}'),
  ('${L_DEL}', '${ORG_A}', '${P3}', now(), NULL),
  ('${LB}', '${ORG_B}', '${PB}', NULL, NULL);
INSERT INTO public.whatsapp_conversations(id, organization_id, instance_id, normalized_phone) VALUES
  ('${C1}', '${ORG_A}', '${BOX_A}', '${P1}'),
  ('${C_B}', '${ORG_B}', '${BOX_B}', '${PB}');
INSERT INTO public.whatsapp_conversation_summary VALUES
  ('${ORG_A}', '${BOX_A}', '${P1}', '${P1}', 'Com lead', 'oi', now() - interval '1 minute', 'incoming', NULL, '${L1}', false),
  ('${ORG_A}', '${BOX_A}', '${P2}', '${P2}', 'Sem nada', 'oi', now() - interval '2 minutes', 'outgoing', 'manual', NULL, false),
  ('${ORG_A}', '${BOX_A}', '${P3}', '${P3}', 'Lead apagado', 'oi', now() - interval '3 minutes', 'incoming', NULL, '${L_DEL}', false),
  ('${ORG_B}', '${BOX_B}', '${PB}', '${PB}', 'Org B', 'oi', now(), 'incoming', NULL, '${LB}', false);
INSERT INTO public.whatsapp_messages VALUES
  ('${ORG_A}', '${BOX_A}', '${P1}', 'incoming', NULL, false, now() - interval '1 minute');
INSERT INTO public.tags VALUES
  ('${T.zeta}', '${ORG_A}', 'Zeta', '#000001'),
  ('${T.alfa}', '${ORG_A}', 'Alfa', '#000002'),
  ('${T.meio}', '${ORG_A}', 'Meio', NULL),
  ('${T.conv}', '${ORG_A}', 'Conversa', '#000004'),
  ('${T.outra}', '${ORG_B}', 'Outra org', '#000005'),
  ('${T.bTag}', '${ORG_B}', 'Da B', '#000006');
-- Ordem de inserção propositalmente diferente da ordem esperada (nome,id).
INSERT INTO public.lead_tags(lead_id, tag_id) VALUES
  ('${L1}', '${T.zeta}'), ('${L1}', '${T.meio}'), ('${L1}', '${T.alfa}'),
  ('${L1}', '${T.outra}'),                       -- vínculo cross-org: não pode vazar
  ('${L_DEL}', '${T.alfa}'),                     -- lead apagado
  ('${LB}', '${T.bTag}');
INSERT INTO public.whatsapp_conversation_tags VALUES
  ('${C1}', '${T.meio}'),                        -- duplicada do lead: fica a do lead
  ('${C1}', '${T.conv}'),
  ('${C1}', '${T.outra}'),                       -- cross-org pela conversa
  ('${C_B}', '${T.bTag}');
`;

// strict_lead_owner_access, na forma de prod (pg_get_functiondef / pg_get_viewdef
// lidos em 19/10). As views só levam as colunas que o corpo da RPC lê.
const STRICT = `
CREATE OR REPLACE FUNCTION private.strict_lead_is_owned(p_org uuid, p_lead uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.leads l
    JOIN public.team_members tm ON tm.organization_id = l.organization_id
      AND tm.user_id = auth.uid() AND tm.is_active
    WHERE l.id = p_lead AND l.organization_id = p_org AND l.deleted_at IS NULL
      AND (
        tm.id IN (l.pre_sale_responsible_id, l.sale_responsible_id, l.sdr_id, l.closer_id)
        OR EXISTS (
          SELECT 1 FROM public.lead_owners own
          WHERE own.lead_id = l.id AND own.organization_id = p_org
            AND own.team_member_id = tm.id AND own.role = 'co'
        )
        OR EXISTS (
          SELECT 1 FROM public.pipeline_entries pe
          WHERE pe.lead_id = l.id AND pe.organization_id = p_org
            AND (pe.assigned_to = tm.id OR tm.id::text IN (
              pe.metadata->>'pre_sale_responsible_id', pe.metadata->>'sale_responsible_id',
              pe.metadata->>'sdr_id', pe.metadata->>'closer_id', pe.metadata->>'responsible_id'
            ))
        )
      )
  )
$function$;
CREATE OR REPLACE FUNCTION private.strict_lead_member_orgs()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT ARRAY(
    SELECT o.id FROM public.organizations o
    WHERE o.feature_flags @> '{"strict_lead_owner_access":true}'::jsonb
      AND COALESCE(auth.role(), '') <> 'service_role'
      AND (auth.uid() IS NOT NULL OR COALESCE(auth.role(), '') IN ('authenticated', 'anon'))
      AND NOT COALESCE(public.is_master_user(), false)
      AND NOT EXISTS (
        SELECT 1 FROM public.team_members tm
        WHERE tm.organization_id = o.id AND tm.user_id = auth.uid()
          AND tm.is_active AND tm.role = 'admin'
      )
  )
$function$;
CREATE OR REPLACE FUNCTION private.strict_lead_ref_visible_in(p_lead uuid, p_strict_orgs uuid[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT cardinality(p_strict_orgs)=0 OR NOT EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id=p_lead
      AND l.organization_id=ANY(p_strict_orgs)
      AND NOT private.strict_lead_is_owned(l.organization_id,l.id)
  )
$function$;
CREATE VIEW private.leads WITH (security_invoker = true) AS
  SELECT id, organization_id, normalized_phone, deleted_at, pre_sale_responsible_id, sale_responsible_id,
         sdr_id, closer_id, responsible_id, qualification_tier
    FROM public.leads
   WHERE ((NOT (organization_id = ANY (( SELECT private.strict_lead_member_orgs() AS strict_lead_member_orgs)::uuid[])))
          OR private.strict_lead_is_owned(organization_id, id));
CREATE VIEW private.lead_tags WITH (security_invoker = true) AS
  SELECT id, lead_id, tag_id, created_at
    FROM public.lead_tags
   WHERE private.strict_lead_ref_visible_in(lead_id, ( SELECT private.strict_lead_member_orgs() AS strict_lead_member_orgs));
-- As outras 6 views de prod: aqui sem recorte (a lista não é o que se testa),
-- só para a forma de prod existir inteira.
CREATE VIEW private.conversation_read_state WITH (security_invoker = true) AS SELECT * FROM public.conversation_read_state;
CREATE VIEW private.conversations WITH (security_invoker = true) AS SELECT * FROM public.conversations;
CREATE VIEW private.pipeline_entries WITH (security_invoker = true) AS SELECT * FROM public.pipeline_entries;
CREATE VIEW private.whatsapp_conversation_summary WITH (security_invoker = true) AS SELECT * FROM public.whatsapp_conversation_summary;
CREATE VIEW private.whatsapp_conversations WITH (security_invoker = true) AS SELECT * FROM public.whatsapp_conversations;
CREATE VIEW private.whatsapp_messages WITH (security_invoker = true) AS SELECT * FROM public.whatsapp_messages;
UPDATE public.organizations SET feature_flags = '{"strict_lead_owner_access": true}' WHERE id = '${ORG_A}';
`;

// Estado de prod antes da migration: a função de 20271125 com a ACL de prod.
const PROD_ACL = `
REVOKE ALL ON FUNCTION ${SIG} FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ${SIG} TO authenticated;
`;

async function freshDb({ strict = false, extra = '' } = {}) {
  const db = new PGlite();
  await db.exec(SKELETON);
  if (strict) await db.exec(STRICT);
  if (extra) await db.exec(extra);
  await db.exec(BASE_FN);
  await db.exec(PROD_ACL);
  return db;
}

/** Chama a RPC como `authenticated` COM claims, e confere o auth.uid() vigente. */
async function call(db, user, args = {}) {
  const claims = JSON.stringify({ sub: user, role: 'authenticated' });
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec('SET ROLE authenticated');
  try {
    const who = await db.query('SELECT auth.uid() AS uid, current_user AS r');
    assert.equal(who.rows[0].uid, user, 'claims não chegaram: o teste não rodaria como o usuário');
    assert.equal(who.rows[0].r, 'authenticated');
    const { org = ORG_A, instances = null, tags = null } = args;
    const r = await db.query(
      `SELECT * FROM public.get_whatsapp_conversation_list_multi(p_org => $1, p_instances => $2::uuid[], p_tags => $3::uuid[])`,
      [org, instances, tags],
    );
    return r.rows;
  } finally {
    await db.exec('RESET ROLE');
    await db.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}
const byPhone = (rows) => Object.fromEntries(rows.map((r) => [r.normalized_phone, r]));
const names = (row) => row.tags.map((t) => t.name);
const withoutTags = (rows) => rows.map(({ tags, ...rest }) => rest);
const acl = async (db) => (await db.query(`SELECT
    has_function_privilege('anon', '${SIG}', 'EXECUTE') AS anon,
    has_function_privilege('service_role', '${SIG}', 'EXECUTE') AS service_role,
    has_function_privilege('authenticated', '${SIG}', 'EXECUTE') AS authenticated,
    (SELECT proacl::text FROM pg_proc WHERE oid = '${SIG}'::regprocedure) AS proacl`)).rows[0];
const countPrivate = (src) => (src.match(/private\./g) ?? []).length;
const prosrc = async (db) => (await db.query(`SELECT prosrc FROM pg_proc WHERE oid = '${SIG}'::regprocedure`)).rows[0].prosrc;

test('base: o corpo de 20271125 no repo é o de prod', () => {
  assert.equal(md5(normalize(bodyOf(BASE_FN))), PROD_PROSRC_MD5);
});

test('g: o corpo novo é o de 20271125 mais só o LATERAL de etiquetas', () => {
  const start = MIG.indexOf('CREATE FUNCTION public.get_whatsapp_conversation_list_multi');
  assert.ok(start > 0, 'migration recria a função com CREATE FUNCTION (após o DROP)');
  const novo = bodyOf(MIG.slice(start)).split('\n');
  const ini = novo.findIndex((l) => l.includes('-- ── ETIQUETAS'));
  const fim = novo.findIndex((l) => l.includes(') et ON true'));
  assert.ok(ini > 0 && fim > ini, 'bloco de etiquetas delimitado');
  const semBloco = [...novo.slice(0, ini), ...novo.slice(fim + 1)];
  const col = semBloco.findIndex((l) => l.trim() === 'et.etiquetas');
  assert.ok(col > 0, 'coluna nova no SELECT final');
  semBloco.splice(col, 1);
  semBloco[col - 1] = semBloco[col - 1].replace(/,$/, '');
  assert.equal(semBloco.join('\n'), bodyOf(BASE_FN));
});

test('a-d, f, g, h: etiquetas, isolamento, ACL, colunas e rollback', async () => {
  const db = await freshDb();
  try {
    const antesRows = await call(db, U.a1, { instances: [BOX_A] });
    const antesRes = (await db.query(`SELECT pg_get_function_result('${SIG}'::regprocedure) AS r,
      pg_get_function_identity_arguments('${SIG}'::regprocedure) AS a`)).rows[0];
    const antesAcl = await acl(db);
    assert.deepEqual([antesAcl.anon, antesAcl.service_role, antesAcl.authenticated], [false, false, true]);

    await db.exec(MIG);

    // f — ACL: só authenticated + owner, mesmo com os default privileges do Supabase.
    const depoisAcl = await acl(db);
    assert.equal(depoisAcl.anon, false, 'anon não executa');
    assert.equal(depoisAcl.service_role, false, 'service_role não executa');
    assert.equal(depoisAcl.authenticated, true, 'authenticated executa');
    assert.equal(depoisAcl.proacl, antesAcl.proacl, 'proacl idêntico ao de prod');

    // g — assinatura igual; retorno = o de antes + `tags jsonb` no fim.
    const depoisRes = (await db.query(`SELECT pg_get_function_result('${SIG}'::regprocedure) AS r,
      pg_get_function_identity_arguments('${SIG}'::regprocedure) AS a,
      (SELECT prosecdef FROM pg_proc WHERE oid='${SIG}'::regprocedure) AS definer,
      (SELECT provolatile FROM pg_proc WHERE oid='${SIG}'::regprocedure) AS vol,
      (SELECT proconfig::text FROM pg_proc WHERE oid='${SIG}'::regprocedure) AS cfg`)).rows[0];
    assert.equal(depoisRes.a, antesRes.a);
    assert.equal(depoisRes.r, antesRes.r.replace(/\)$/, ', tags jsonb)'));
    assert.deepEqual([depoisRes.definer, depoisRes.vol, depoisRes.cfg], [true, 's', '{search_path=public}']);
    // sem as views private.*, o corpo não as cita
    assert.ok(!(await prosrc(db)).includes('private.'));

    const rows = await call(db, U.a1, { instances: [BOX_A] });
    assert.deepEqual(withoutTags(rows), antesRows, 'demais colunas e linhas idênticas');
    const p = byPhone(rows);

    // a — lead primeiro (nome,id), depois conversa; Meio deduplicada fica como do lead.
    assert.deepEqual(names(p[P1]), ['Alfa', 'Meio', 'Zeta', 'Conversa']);
    assert.deepEqual(p[P1].tags[0], { id: T.alfa, name: 'Alfa', color: '#000002' });
    assert.deepEqual(p[P1].tags[1], { id: T.meio, name: 'Meio', color: null });
    // b — sem lead e sem conversa: array vazio, nunca NULL.
    assert.deepEqual(p[P2].tags, []);
    // c — lead apagado não empresta etiqueta.
    assert.deepEqual(p[P3].tags, []);
    // d — 'Outra org' (vinculada por lead e por conversa) não aparece.
    for (const r of rows) assert.ok(!names(r).includes('Outra org') && !names(r).includes('Da B'));

    // p_tags continua filtrando pelas duas origens.
    assert.deepEqual((await call(db, U.a1, { tags: [T.conv] })).map((r) => r.normalized_phone), [P1]);
    assert.deepEqual((await call(db, U.a1, { tags: [T.zeta] })).map((r) => r.normalized_phone), [P1]);
    assert.deepEqual(await call(db, U.a1, { tags: [T.bTag] }), []);

    // Fronteira de org intacta: membro da B pedindo a A → 42501.
    await assert.rejects(call(db, U.b, { org: ORG_A }), /forbidden: org not accessible/);
    // Membro da B na B vê a própria etiqueta.
    assert.deepEqual(names(byPhone(await call(db, U.b, { org: ORG_B }))[PB]), ['Da B']);

    // h — rollback: retorno antigo, ACL intacta, mesmas linhas.
    await db.exec(RB);
    const rbRes = (await db.query(`SELECT pg_get_function_result('${SIG}'::regprocedure) AS r`)).rows[0];
    assert.equal(rbRes.r, antesRes.r);
    const rbAcl = await acl(db);
    assert.deepEqual([rbAcl.anon, rbAcl.service_role, rbAcl.authenticated], [false, false, true]);
    assert.equal(rbAcl.proacl, antesAcl.proacl);
    assert.equal(md5(normalize(await prosrc(db))), PROD_PROSRC_MD5, 'rollback = corpo de prod');
    assert.deepEqual(await call(db, U.a1, { instances: [BOX_A] }), antesRows);
  } finally {
    await db.close();
  }
});

test('e, i: strict_lead_owner_access espelhado pelas views private.* da forma de prod', async () => {
  const db = await freshDb({ strict: true });
  try {
    await db.exec(MIG);

    // i — com as views presentes, o corpo lê private.* nas relações que têm view
    // (como prod faz hoje), e normalizado volta a ser exatamente o do repo.
    const src = await prosrc(db);
    assert.ok(src.includes('private.lead_tags lt'), 'etiqueta do lead lida pela view com o recorte strict');
    assert.ok(src.includes('private.leads l'), 'lead lido pela view com o recorte strict');
    assert.ok(!src.includes('public.lead_tags') && !src.includes('public.leads '));
    assert.ok(src.includes('public.whatsapp_conversation_tags') && src.includes('public.tags t'),
      'relações sem view private.* ficam em public');
    const migBody = bodyOf(MIG.slice(MIG.indexOf('CREATE FUNCTION public.get_whatsapp_conversation_list_multi')));
    assert.equal(normalize(src), migBody);
    assert.equal(countPrivate(src), 15, '13 do corpo de prod + lead_tags e leads do LATERAL');
    assert.ok(src.includes('public.team_members tm') && src.includes('public.organizations o')
      && src.includes('public.member_feature_permissions mfp'), 'gate e isolamento ficam em public');
    const a = await acl(db);
    assert.deepEqual([a.anon, a.service_role, a.authenticated], [false, false, true], 'troca de prefixo preserva a ACL');

    // e — membro não-dono: a conversa aparece (o recorte da LISTA não é desta
    // migration), mas a etiqueta do lead não; a da conversa sim.
    const naoDono = byPhone(await call(db, U.a1, { instances: [BOX_A] }));
    assert.deepEqual(names(naoDono[P1]), ['Conversa', 'Meio']);
    // dono (sale_responsible_id) vê tudo.
    assert.deepEqual(names(byPhone(await call(db, U.a2, { instances: [BOX_A] }))[P1]), ['Alfa', 'Meio', 'Zeta', 'Conversa']);
    // admin da org e master ficam fora do strict (strict_lead_member_orgs).
    assert.deepEqual(names(byPhone(await call(db, U.adm, { instances: [BOX_A] }))[P1]), ['Alfa', 'Meio', 'Zeta', 'Conversa']);
    assert.deepEqual(names(byPhone(await call(db, U.master, { instances: [BOX_A] }))[P1]), ['Alfa', 'Meio', 'Zeta', 'Conversa']);

    // Controle positivo: o mesmo não-dono, com a flag desligada, vê tudo.
    await db.exec(`UPDATE public.organizations SET feature_flags = '{}' WHERE id = '${ORG_A}'`);
    assert.deepEqual(names(byPhone(await call(db, U.a1, { instances: [BOX_A] }))[P1]), ['Alfa', 'Meio', 'Zeta', 'Conversa']);

    // rollback também volta à forma de prod (private.*) e ao md5 de prod.
    await db.exec(RB);
    const rbSrc = await prosrc(db);
    assert.ok(rbSrc.includes('private.leads') && rbSrc.includes('private.lead_tags'));
    assert.equal(countPrivate(rbSrc), 13, 'rollback = contagem de prod hoje');
    assert.equal(md5(normalize(rbSrc)), PROD_PROSRC_MD5);
  } finally {
    await db.close();
  }
});

test('j: strict instalado e uma das 8 views faltando → apply falha fechado', async () => {
  const db = await freshDb({ strict: true, extra: 'DROP VIEW private.whatsapp_messages;' });
  try {
    const antes = await prosrc(db);
    await assert.rejects(db.exec(MIG), /forma de prod incompleta.*private\.whatsapp_messages/);
    await db.exec('ROLLBACK');
    // Nada do apply sobrou: mesma função, mesmo retorno, mesma ACL.
    assert.equal(await prosrc(db), antes);
    const r = (await db.query(`SELECT pg_get_function_result('${SIG}'::regprocedure) AS r`)).rows[0].r;
    assert.ok(!r.includes('tags jsonb'));
    const a = await acl(db);
    assert.deepEqual([a.anon, a.service_role, a.authenticated], [false, false, true]);
  } finally {
    await db.close();
  }
});

test('j: o rollback também falha fechado sem uma das 8 views', async () => {
  const db = await freshDb({ strict: true });
  try {
    await db.exec(MIG);
    await db.exec('DROP VIEW private.conversations;');
    await assert.rejects(db.exec(RB), /forma de prod incompleta.*private\.conversations/);
    await db.exec('ROLLBACK');
  } finally {
    await db.close();
  }
});

test('k: view private.team_members presente NÃO é trocada', async () => {
  const db = await freshDb({
    strict: true,
    extra: `CREATE VIEW private.team_members WITH (security_invoker = true) AS SELECT * FROM public.team_members WHERE false;
            CREATE VIEW private.organizations WITH (security_invoker = true) AS SELECT * FROM public.organizations WHERE false;
            CREATE VIEW private.tags WITH (security_invoker = true) AS SELECT * FROM public.tags WHERE false;`,
  });
  try {
    await db.exec(MIG);
    const src = await prosrc(db);
    assert.ok(!src.includes('private.team_members') && !src.includes('private.organizations')
      && !src.includes('private.tags'));
    assert.equal(countPrivate(src), 15);
    // As views vazias não alcançam a função: a etiqueta continua visível.
    assert.deepEqual(names(byPhone(await call(db, U.a2, { instances: [BOX_A] }))[P1]), ['Alfa', 'Meio', 'Zeta', 'Conversa']);
  } finally {
    await db.close();
  }
});
