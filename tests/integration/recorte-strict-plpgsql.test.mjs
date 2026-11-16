// Recorte strict_lead_owner_access em plpgsql
// (20280118000000_recorte_strict_em_plpgsql.sql).
//
// A migration troca a LINGUAGEM de quatro funções do recorte (sql → plpgsql)
// gerando o corpo novo a partir do `prosrc` vivo: `BEGIN RETURN (<SELECT>); END`.
// Provado aqui, com os corpos EXATOS de prod (md5 conferido) e chamando como
// `authenticated` COM claims:
//   a. equivalência: as quatro funções devolvem o mesmo valor, antes e depois,
//      numa matriz de (usuário × org × lead × telefone × canal), incluindo
//      NULLs e os desvios de prod (escopo JR Tex, balcão Riofix, Izadora);
//   b. forma: plpgsql, corpo = original embrulhado, mesmo cabeçalho
//      (STABLE, SECURITY DEFINER, search_path ''), mesma ACL;
//   c. reaplicar é no-op; o rollback devolve LANGUAGE sql com o md5 original
//      e a mesma saída;
//   d. falha FECHADA: corpo vivo divergente do revisado → apply aborta e nada
//      muda; recorte parcial (só parte das funções) → aborta;
//   e. forma do repo (sem as funções): no-op.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MIG = read('../../supabase/migrations/20280118000000_recorte_strict_em_plpgsql.sql');
const RB = read('../../supabase/migrations/rollback/20280118000000_recorte_strict_em_plpgsql.sql');
const md5 = (s) => createHash('md5').update(s).digest('hex');

// Corpos VIVOS de prod (prosrc), 16/11/2026 — byte a byte, inclusive CRLF.
const SRC = {
  member_orgs: "SELECT ARRAY(SELECT DISTINCT x FROM unnest((\r\n SELECT ARRAY(SELECT DISTINCT org FROM unnest(( SELECT ARRAY(\r\n    SELECT o.id FROM public.organizations o\r\n    WHERE o.feature_flags @> '{\"strict_lead_owner_access\":true}'::jsonb\r\n      AND COALESCE(auth.role(), '') <> 'service_role'\r\n      AND (auth.uid() IS NOT NULL OR COALESCE(auth.role(), '') IN ('authenticated', 'anon'))\r\n      AND NOT COALESCE(public.is_master_user(), false)\r\n      AND NOT EXISTS (\r\n        SELECT 1 FROM public.team_members tm\r\n        WHERE tm.organization_id = o.id AND tm.user_id = auth.uid()\r\n          AND tm.is_active AND tm.role = 'admin'\r\n      )\r\n  ) ) || CASE WHEN private.riofix_balcao_current_scope() IS NOT NULL THEN ARRAY['36971ff5-fd73-4f30-a733-04bf8c90e5b6'::uuid] ELSE '{}'::uuid[] END) org)\r\n) || CASE WHEN private.jrtex_caller_lead_scoped() THEN ARRAY['30bb5c27-88f4-4f91-9493-835405ae2e11'::uuid] ELSE '{}'::uuid[] END) x)",
  is_owned: "SELECT CASE WHEN private.jrtex_lead_scope_for_user(auth.uid(),p_org) IS NOT NULL THEN private.jrtex_caller_lead(p_org,p_lead) ELSE (\r\n SELECT CASE WHEN private.riofix_balcao_scope_for_user(auth.uid(),p_org) IS NOT NULL THEN private.riofix_balcao_caller_lead(p_org,p_lead) ELSE (SELECT auth.uid() IS NOT NULL AND EXISTS (\r\n    SELECT 1 FROM public.leads l\r\n    JOIN public.team_members tm ON tm.organization_id = l.organization_id\r\n      AND tm.user_id = auth.uid() AND tm.is_active\r\n    WHERE l.id = p_lead AND l.organization_id = p_org AND l.deleted_at IS NULL\r\n      AND (\r\n        tm.id IN (l.pre_sale_responsible_id, l.sale_responsible_id, l.sdr_id, l.closer_id)\r\n        OR EXISTS (\r\n          SELECT 1 FROM public.lead_owners own\r\n          WHERE own.lead_id = l.id AND own.organization_id = p_org\r\n            AND own.team_member_id = tm.id AND own.role = 'co'\r\n        )\r\n        OR EXISTS (\r\n          SELECT 1 FROM public.pipeline_entries pe\r\n          WHERE pe.lead_id = l.id AND pe.organization_id = p_org\r\n            AND (pe.assigned_to = tm.id OR tm.id::text IN (\r\n              pe.metadata->>'pre_sale_responsible_id', pe.metadata->>'sale_responsible_id',\r\n              pe.metadata->>'sdr_id', pe.metadata->>'closer_id', pe.metadata->>'responsible_id'\r\n            ))\r\n        )\r\n      )\r\n  )) END\r\n) END",
  phone_visible: "\r\n SELECT CASE WHEN private.jrtex_izadora_new_chat(auth.uid(),p_org,p_lead,p_phone) THEN true WHEN private.riofix_balcao_scope_for_user(auth.uid(),p_org) IS NOT NULL THEN private.riofix_balcao_caller_chat(p_org,p_lead,p_phone) ELSE (SELECT NOT (p_org=ANY((SELECT private.strict_lead_member_orgs())::uuid[]))\r\n    OR EXISTS (\r\n      SELECT 1 FROM public.leads l WHERE l.organization_id=p_org\r\n        AND ((p_lead IS NOT NULL AND l.id=p_lead)\r\n          OR (p_lead IS NULL AND l.normalized_phone=p_phone))\r\n        AND private.strict_lead_is_owned(p_org,l.id)\r\n    )) END\r\n",
  channel_visible: "\n SELECT NOT(p_org=ANY((SELECT private.strict_lead_member_orgs())::uuid[]))\n OR EXISTS (\n   SELECT 1 FROM public.messaging_channels mc JOIN public.lead_social_identities si\n     ON si.organization_id=mc.organization_id AND si.channel_type=mc.channel_type\n   WHERE mc.id::text=p_channel AND mc.organization_id=p_org AND si.external_user_id=p_external\n     AND private.strict_lead_is_owned(p_org,si.lead_id)\n )\n OR (NOT EXISTS(SELECT 1 FROM public.messaging_channels mc WHERE mc.id::text=p_channel\n       AND mc.organization_id=p_org AND mc.channel_type IN('instagram','facebook','messenger'))\n   AND private.strict_phone_visible(p_org,p_lead,public.normalize_brazilian_phone(COALESCE(p_phone,p_external))))\n",
};
const MD5 = {
  member_orgs: '422ec5d40d1a0574efd6f2786e1a118e',
  is_owned: 'd6e9b67bd2be794aa0cf130d515e5a1f',
  phone_visible: '6c5792c8e7cc8cbb6b6a7019a3cb6be1',
  channel_visible: 'bb9688439b7d01049b7adfc4e95faee5',
};
const SIG = {
  member_orgs: 'private.strict_lead_member_orgs()',
  is_owned: 'private.strict_lead_is_owned(uuid,uuid)',
  phone_visible: 'private.strict_phone_visible(uuid,uuid,text)',
  channel_visible: 'private.strict_channel_visible(uuid,uuid,text,text,text)',
};

const id = (p, n) => `${p}000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`;
const JRTEX = '30bb5c27-88f4-4f91-9493-835405ae2e11';
const RIOFIX = '36971ff5-fd73-4f30-a733-04bf8c90e5b6';
const ORG = id('0a', 1); // org comum com strict ligado
const ORG_LIVRE = id('0a', 2); // sem strict
const U = { adm: id('0b', 1), mem: id('0b', 2), out: id('0b', 3), mst: id('0b', 4), jr: id('0b', 5), rf: id('0b', 6) };
const TM = { adm: id('0c', 1), mem: id('0c', 2), jr: id('0c', 5), rf: id('0c', 6) };
const L = { dono: id('0e', 1), co: id('0e', 2), pipe: id('0e', 3), meta: id('0e', 4), alheio: id('0e', 5),
  apagado: id('0e', 6), livre: id('0e', 7), jr: id('0e', 8), rf: id('0e', 9) };
const PH = { dono: '5548900000001', co: '5548900000002', pipe: '5548900000003', meta: '5548900000004',
  alheio: '5548900000005', apagado: '5548900000006', livre: '5548900000007', jr: '5548900000008',
  rf: '5548900000009', nenhum: '5548900000099' };
const CH = { ig: id('0d', 1), wa: id('0d', 2) };

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

CREATE TABLE public.organizations (id uuid PRIMARY KEY, feature_flags jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.team_members (id uuid PRIMARY KEY, user_id uuid, organization_id uuid,
  is_active boolean NOT NULL DEFAULT true, role text NOT NULL DEFAULT 'member');
CREATE TABLE public.master_users (user_id uuid, is_active boolean);
CREATE TABLE public.leads (id uuid PRIMARY KEY, organization_id uuid, normalized_phone text, deleted_at timestamptz,
  pre_sale_responsible_id uuid, sale_responsible_id uuid, sdr_id uuid, closer_id uuid);
CREATE TABLE public.lead_owners (lead_id uuid, organization_id uuid, team_member_id uuid, role text);
CREATE TABLE public.pipeline_entries (lead_id uuid, organization_id uuid, assigned_to uuid, metadata jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.messaging_channels (id uuid PRIMARY KEY, organization_id uuid, channel_type text);
CREATE TABLE public.lead_social_identities (organization_id uuid, channel_type text, external_user_id text, lead_id uuid);

CREATE FUNCTION public.is_master_user(_user_id uuid DEFAULT auth.uid()) RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN RETURN EXISTS (SELECT 1 FROM public.master_users WHERE user_id = _user_id AND is_active = true); END $$;
CREATE FUNCTION public.normalize_brazilian_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '') $$;

CREATE SCHEMA private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
-- Desvios de prod em forma neutra, ligados por botões (o que importa aqui é
-- que o RAMO de cada desvio seja exercitado antes e depois).
CREATE TABLE private.knobs (jr_user uuid, rf_user uuid, izadora_phone text);
GRANT SELECT ON private.knobs TO authenticated;
INSERT INTO private.knobs VALUES ('${U.jr}', '${U.rf}', '${PH.alheio}');
CREATE FUNCTION private.jrtex_lead_scope_for_user(p_user uuid, p_org uuid) RETURNS text LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path TO '' AS $$
  SELECT 'SP' FROM private.knobs k WHERE k.jr_user = p_user AND p_org = '${JRTEX}'::uuid $$;
CREATE FUNCTION private.jrtex_caller_lead(p_org uuid, p_lead uuid) RETURNS boolean LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path TO '' AS $$ SELECT p_lead = '${L.jr}'::uuid $$;
CREATE FUNCTION private.jrtex_caller_lead_scoped() RETURNS boolean LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path TO '' AS $$
  SELECT private.jrtex_lead_scope_for_user(auth.uid(), '${JRTEX}') IS NOT NULL $$;
CREATE FUNCTION private.jrtex_izadora_new_chat(p_user uuid, p_org uuid, p_lead uuid, p_phone text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT p_user = (SELECT jr_user FROM private.knobs) AND p_lead IS NULL
     AND p_phone = (SELECT izadora_phone FROM private.knobs) $$;
CREATE FUNCTION private.riofix_balcao_scope_for_user(p_user uuid, p_org uuid) RETURNS uuid LANGUAGE sql STABLE
  SET search_path TO '' AS $$
  SELECT '${id('09', 1)}'::uuid FROM private.knobs k WHERE k.rf_user = p_user AND p_org = '${RIOFIX}'::uuid $$;
CREATE FUNCTION private.riofix_balcao_current_scope() RETURNS uuid LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE WHEN auth.uid() IS NOT NULL THEN private.riofix_balcao_scope_for_user(auth.uid(), '${RIOFIX}'::uuid) END $$;
CREATE FUNCTION private.riofix_balcao_caller_lead(p_org uuid, p_lead uuid) RETURNS boolean LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path TO '' AS $$ SELECT p_lead = '${L.rf}'::uuid $$;
CREATE FUNCTION private.riofix_balcao_caller_chat(p_org uuid, p_lead uuid, p_phone text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT p_lead = '${L.rf}'::uuid OR p_phone = '${PH.rf}' $$;

INSERT INTO public.organizations VALUES
  ('${ORG}', '{"strict_lead_owner_access":true}'), ('${ORG_LIVRE}', '{}'),
  ('${JRTEX}', '{"strict_lead_owner_access":true}'), ('${RIOFIX}', '{}');
INSERT INTO public.team_members(id, user_id, organization_id, role) VALUES
  ('${TM.adm}', '${U.adm}', '${ORG}', 'admin'), ('${TM.mem}', '${U.mem}', '${ORG}', 'member'),
  ('${id('0c', 7)}', '${U.mem}', '${ORG_LIVRE}', 'member'),
  ('${TM.jr}', '${U.jr}', '${JRTEX}', 'member'), ('${TM.rf}', '${U.rf}', '${RIOFIX}', 'member');
INSERT INTO public.master_users VALUES ('${U.mst}', true);
INSERT INTO public.leads(id, organization_id, normalized_phone, deleted_at, sale_responsible_id, sdr_id) VALUES
  ('${L.dono}', '${ORG}', '${PH.dono}', NULL, '${TM.mem}', NULL),
  ('${L.co}', '${ORG}', '${PH.co}', NULL, NULL, NULL),
  ('${L.pipe}', '${ORG}', '${PH.pipe}', NULL, NULL, NULL),
  ('${L.meta}', '${ORG}', '${PH.meta}', NULL, NULL, NULL),
  ('${L.alheio}', '${ORG}', '${PH.alheio}', NULL, '${TM.adm}', NULL),
  ('${L.apagado}', '${ORG}', '${PH.apagado}', now(), '${TM.mem}', NULL),
  ('${L.livre}', '${ORG_LIVRE}', '${PH.livre}', NULL, NULL, NULL),
  ('${L.jr}', '${JRTEX}', '${PH.jr}', NULL, NULL, NULL),
  ('${L.rf}', '${RIOFIX}', '${PH.rf}', NULL, NULL, NULL);
INSERT INTO public.lead_owners VALUES ('${L.co}', '${ORG}', '${TM.mem}', 'co');
INSERT INTO public.pipeline_entries(lead_id, organization_id, assigned_to, metadata) VALUES
  ('${L.pipe}', '${ORG}', '${TM.mem}', '{}'),
  ('${L.meta}', '${ORG}', NULL, '{"closer_id":"${TM.mem}"}');
INSERT INTO public.messaging_channels VALUES ('${CH.ig}', '${ORG}', 'instagram'), ('${CH.wa}', '${ORG}', 'whatsapp');
INSERT INTO public.lead_social_identities VALUES ('${ORG}', 'instagram', 'ig_dono', '${L.dono}'),
  ('${ORG}', 'instagram', 'ig_alheio', '${L.alheio}');
`;

// As quatro funções do recorte com o corpo EXATO de prod, como em prod.
const PROD_FNS = `
CREATE FUNCTION private.strict_lead_member_orgs() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO '' AS $body$${SRC.member_orgs}$body$;
CREATE FUNCTION private.strict_lead_is_owned(p_org uuid, p_lead uuid) RETURNS boolean LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path TO '' AS $body$${SRC.is_owned}$body$;
CREATE FUNCTION private.strict_phone_visible(p_org uuid, p_lead uuid, p_phone text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $body$${SRC.phone_visible}$body$;
CREATE FUNCTION private.strict_channel_visible(p_org uuid, p_lead uuid, p_channel text, p_external text, p_phone text)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $body$${SRC.channel_visible}$body$;
REVOKE ALL ON FUNCTION private.strict_lead_member_orgs(), private.strict_lead_is_owned(uuid,uuid),
  private.strict_phone_visible(uuid,uuid,text), private.strict_channel_visible(uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.strict_lead_member_orgs(), private.strict_lead_is_owned(uuid,uuid),
  private.strict_phone_visible(uuid,uuid,text), private.strict_channel_visible(uuid,uuid,text,text,text)
  TO authenticated, service_role;
`;

async function db({ fns = true } = {}) {
  const pg = new PGlite();
  await pg.exec(SKELETON);
  if (fns) await pg.exec(PROD_FNS);
  return pg;
}

async function as(pg, user, fn) {
  await pg.query(`SELECT set_config('request.jwt.claims', $1, false)`,
    [user ? JSON.stringify({ sub: user, role: 'authenticated' }) : '']);
  await pg.exec('SET ROLE authenticated');
  try {
    const who = await pg.query('SELECT auth.uid() AS uid, current_user AS r');
    assert.equal(who.rows[0].uid, user ?? null, 'claims não chegaram');
    assert.equal(who.rows[0].r, 'authenticated');
    return await fn();
  } finally {
    await pg.exec('RESET ROLE');
    await pg.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

const ORGS = [ORG, ORG_LIVRE, JRTEX, RIOFIX, null];
const LEADS = [...Object.values(L), id('0e', 99), null];
const PHONES = [...Object.values(PH), null];

// Matriz inteira em UMA consulta por usuário: (org × lead × telefone) para
// is_owned/phone_visible e (org × canal × externo × telefone) para channel.
async function snapshot(pg) {
  const out = {};
  for (const [who, user] of Object.entries({ ...U, anon: null })) {
    out[who] = await as(pg, user, async () => {
      const r = await pg.query(`
        SELECT
          (SELECT private.strict_lead_member_orgs()) AS orgs,
          (SELECT jsonb_agg(jsonb_build_array(o, l, private.strict_lead_is_owned(o, l)) ORDER BY o, l)
             FROM unnest($1::uuid[]) o, unnest($2::uuid[]) l) AS owned,
          (SELECT jsonb_agg(jsonb_build_array(o, l, p, private.strict_phone_visible(o, l, p)) ORDER BY o, l, p)
             FROM unnest($1::uuid[]) o, unnest($2::uuid[]) l, unnest($3::text[]) p) AS phone,
          (SELECT jsonb_agg(jsonb_build_array(o, c, e, p, private.strict_channel_visible(o, NULL, c, e, p)) ORDER BY o, c, e, p)
             FROM unnest($1::uuid[]) o,
                  unnest(ARRAY[$4::text, $5::text, NULL]) c,
                  unnest(ARRAY['ig_dono', 'ig_alheio', NULL]) e,
                  unnest(ARRAY[$6::text, $7::text, NULL]) p) AS channel`,
        [ORGS, LEADS, PHONES, CH.ig, CH.wa, PH.dono, PH.alheio]);
      return r.rows[0];
    });
  }
  return out;
}

async function funcs(pg) {
  const r = await pg.query(`
    SELECT p.oid::regprocedure::text AS sig, l.lanname, p.prosrc, p.prosecdef, p.provolatile,
           p.proconfig, p.proacl::text AS acl
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'private' AND p.proname LIKE 'strict\\_%' ORDER BY 1`);
  return Object.fromEntries(r.rows.map((x) => [x.sig, x]));
}

test('corpos do teste são os de prod (md5 igual ao travado na migration)', () => {
  for (const k of Object.keys(SRC)) {
    assert.equal(md5(SRC[k]), MD5[k], k);
    assert.ok(MIG.includes(MD5[k]), `migration trava ${k}`);
    assert.ok(RB.includes(MD5[k]), `rollback trava ${k}`);
  }
});

test('a+b: mesma saída antes e depois; plpgsql com corpo embrulhado e mesmo cabeçalho/ACL', async () => {
  const pg = await db();
  const fAntes = await funcs(pg);
  const antes = await snapshot(pg);
  await pg.exec(MIG);
  const depois = await snapshot(pg);
  assert.deepEqual(depois, antes);

  // O conjunto exercita o que diz (senão a igualdade seria verde por vazio).
  // Toda org com o flag entra para quem NÃO é admin dela (pertencer não é
  // condição) — é a regra viva.
  assert.deepEqual([...antes.mem.orgs].sort(), [ORG, JRTEX].sort(), 'membro: orgs strict');
  assert.deepEqual(antes.adm.orgs, [JRTEX], 'admin da ORG fica fora dela');
  assert.deepEqual(antes.mst.orgs, [], 'master fica fora');
  assert.ok(antes.jr.orgs.includes(JRTEX), 'escopo JR Tex entra');
  assert.ok(antes.rf.orgs.includes(RIOFIX), 'balcão Riofix entra');
  const owned = (who, o, l) => antes[who].owned.find((x) => x[0] === o && x[1] === l)[2];
  assert.equal(owned('mem', ORG, L.dono), true, 'responsável');
  assert.equal(owned('mem', ORG, L.co), true, 'co-dono');
  assert.equal(owned('mem', ORG, L.pipe), true, 'pipeline assigned_to');
  assert.equal(owned('mem', ORG, L.meta), true, 'pipeline metadata');
  assert.equal(owned('mem', ORG, L.alheio), false, 'lead de outro');
  assert.equal(owned('mem', ORG, L.apagado), false, 'apagado');
  assert.equal(owned('jr', JRTEX, L.jr), true, 'ramo JR Tex');
  assert.equal(owned('rf', RIOFIX, L.rf), true, 'ramo Riofix');
  const phone = (who, o, l, p) => antes[who].phone.find((x) => x[0] === o && x[1] === l && x[2] === p)[3];
  assert.equal(phone('mem', ORG, null, PH.dono), true);
  assert.equal(phone('mem', ORG, null, PH.alheio), false);
  assert.equal(phone('mem', ORG_LIVRE, null, PH.nenhum), true, 'org fora do strict: livre');
  assert.equal(phone('jr', JRTEX, null, PH.alheio), true, 'ramo Izadora');
  assert.equal(phone('rf', RIOFIX, null, PH.rf), true, 'ramo balcão');
  assert.equal(phone('mem', null, null, PH.dono), null, 'org NULL → NULL, igual ao SQL');

  const fDepois = await funcs(pg);
  for (const [sig, f] of Object.entries(fAntes)) {
    const g = fDepois[sig];
    assert.equal(f.lanname, 'sql', `${sig} era sql`);
    assert.equal(g.lanname, 'plpgsql', `${sig} virou plpgsql`);
    assert.equal(g.prosrc, `BEGIN RETURN (${f.prosrc}); END`, `${sig}: corpo = original embrulhado`);
    for (const k of ['prosecdef', 'provolatile', 'acl']) assert.deepEqual(g[k], f[k], `${sig}: ${k}`);
    assert.deepEqual(g.proconfig, f.proconfig, `${sig}: search_path`);
  }
});

test('c: reaplicar é no-op; rollback devolve sql com o md5 original e a mesma saída', async () => {
  const pg = await db();
  const antes = await snapshot(pg);
  const f0 = await funcs(pg);
  await pg.exec(MIG);
  const f1 = await funcs(pg);
  await pg.exec(MIG);
  assert.deepEqual(await funcs(pg), f1, 'segunda aplicação não muda nada');
  await pg.exec(RB);
  const f2 = await funcs(pg);
  for (const [sig, f] of Object.entries(f0)) {
    assert.equal(f2[sig].lanname, 'sql');
    assert.equal(f2[sig].prosrc, f.prosrc, `${sig}: corpo original de volta`);
    assert.equal(f2[sig].acl, f.acl);
  }
  await pg.exec(RB);
  assert.deepEqual(await funcs(pg), f2, 'rollback reaplicado é no-op');
  assert.deepEqual(await snapshot(pg), antes);
});

test('d: corpo vivo divergente → apply aborta e nada muda; recorte parcial → aborta', async () => {
  const pg = await db();
  await pg.exec(`CREATE OR REPLACE FUNCTION private.strict_phone_visible(p_org uuid, p_lead uuid, p_phone text)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$ SELECT true $$`);
  const antes = await funcs(pg);
  await assert.rejects(pg.exec(`BEGIN;\n${MIG}\nCOMMIT;`), /strict_phone_visible.*divergiu do corpo revisado/);
  await pg.exec('ROLLBACK');
  assert.deepEqual(await funcs(pg), antes, 'nenhuma das quatro mudou');

  const pg2 = await db();
  await pg2.exec('DROP FUNCTION private.strict_channel_visible(uuid,uuid,text,text,text)');
  await assert.rejects(pg2.exec(`BEGIN;\n${MIG}\nCOMMIT;`), /recorte strict parcial/);
});

test('e: forma do repo (sem o recorte) — no-op, nas duas direções', async () => {
  const pg = await db({ fns: false });
  await pg.exec(MIG);
  await pg.exec(RB);
  assert.deepEqual(await funcs(pg), {});
});
