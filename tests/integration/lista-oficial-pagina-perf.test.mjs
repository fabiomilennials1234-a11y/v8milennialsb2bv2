// get_official_whatsapp_conversation_list_multi com página preguiçosa
// (20280119010000_lista_oficial_pagina_antes_do_escopo.sql).
//
// Provado aqui, como `authenticated` COM claims:
//   a. equivalência: a função viva de prod (o rollback, md5 conferido) e a
//      nova devolvem exatamente as mesmas linhas, na mesma ordem, em 7
//      cenários × 2 usuários × recorte strict ligado/desligado — sobre um
//      conjunto que exercita: escopo que esconde conversa (o filtro antigo
//      por mensagem), empate de timestamp na borda da página (cursor
//      composto), cursor parcial, nome/avatar da última RECEBIDA com a última
//      mensagem de SAÍDA, conversa sem nenhuma recebida, leitura por caixa,
//      dois leads com o mesmo telefone, lead que o usuário não pode ler,
//      contato sem contact_external_id, outra org;
//   b. preguiça: `can_see_chat_scope` roda uma vez por CONVERSA visitada, e
//      para quando a página enche (antes: uma vez por mensagem, todas);
//   c. forma de prod: as 3 relações em private.*, 5 ocorrências; forma do
//      repo: aplica sem trocar e roda;
//   d. ACL igual à de prod; gate de org 42501 nas duas versões.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MIG = read('../../supabase/migrations/20280119010000_lista_oficial_pagina_antes_do_escopo.sql');
const RB = read('../../supabase/migrations/rollback/20280119010000_lista_oficial_pagina_antes_do_escopo.sql');

const SIG = 'public.get_official_whatsapp_conversation_list_multi(uuid,uuid[],integer,timestamp with time zone,uuid,text)';
const RELS = ['channel_messages', 'conversation_read_state', 'leads'];

const id = (p, n) => `${p}000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`;
const ORG = id('0a', 1);
const ORG2 = id('0a', 2);
const U = { adm: id('0b', 1), mem: id('0b', 2) };
const U_FORA = id('0b', 9);
const TM = { adm: id('0c', 1), mem: id('0c', 2) };
const A = id('0d', 1), B = id('0d', 2), X = id('0d', 9);
const C = {
  c1: '5548900000001', // A: recebidas + resposta nossa por último (nome da recebida)
  c2: '5548900000002', // A: só saída (sem identidade)
  c3: '5548900000003', // A: escondido pelo escopo do membro
  c4: '5548900000004', // A e B: fala com as duas caixas; leitura só na B
  c5: '5548900000005', // B: empate de timestamp com c6
  c6: '5548900000006', // B
  c7: '5548900000007', // A: dois leads com o mesmo telefone
  c8: '5548900000008', // A: lead que o membro não lê
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
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.team_members (id uuid PRIMARY KEY, user_id uuid, organization_id uuid,
  is_active boolean NOT NULL DEFAULT true, role text NOT NULL DEFAULT 'member');
CREATE TABLE public.master_users (user_id uuid, is_active boolean);
CREATE TABLE public.whatsapp_instances (id uuid PRIMARY KEY, organization_id uuid);
CREATE TABLE public.leads (id uuid PRIMARY KEY, organization_id uuid, normalized_phone text, name text,
  deleted_at timestamptz, created_at timestamptz, sale_responsible_id uuid);
CREATE TABLE public.channel_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
  instance_id uuid, contact_external_id text, content text, "timestamp" timestamptz, direction text,
  sender_name text, sender_profile_pic text, contact_handle text);
CREATE TABLE public.conversation_read_state (organization_id uuid, user_id uuid, conversation_key text,
  last_read_at timestamptz, UNIQUE (organization_id, user_id, conversation_key));
-- Quem o escopo esconde do membro (a regra real fica em prod; aqui importa
-- que o filtro ESCONDA e que seja chamado igual).
CREATE TABLE public.escopo_oculto (normalized_phone text);
-- Contador de chamadas do escopo (prova da preguiça).
CREATE SEQUENCE public.chamadas_escopo;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.chamadas_escopo TO authenticated;

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
CREATE FUNCTION public.normalize_brazilian_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '') $$;
-- VOLATILE só por causa do contador; o resultado depende só do telefone.
CREATE FUNCTION public.can_see_chat_scope(p_org_id uuid, p_lead_id uuid, p_normalized_phone text)
  RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  PERFORM nextval('public.chamadas_escopo');
  RETURN NOT EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.user_id = auth.uid()
                       AND tm.organization_id = p_org_id AND tm.role <> 'admin')
      OR NOT EXISTS (SELECT 1 FROM public.escopo_oculto o WHERE o.normalized_phone = p_normalized_phone);
END $$;
CREATE FUNCTION public.can_link_or_read_lead(p_lead_id uuid, p_org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.leads l JOIN public.team_members tm
                   ON tm.organization_id = l.organization_id AND tm.user_id = auth.uid()
                  WHERE l.id = p_lead_id AND (tm.role = 'admin' OR l.sale_responsible_id = tm.id)) $$;

INSERT INTO public.team_members(id, user_id, organization_id, role) VALUES
  ('${TM.adm}', '${U.adm}', '${ORG}', 'admin'), ('${TM.mem}', '${U.mem}', '${ORG}', 'member'),
  ('${id('0c', 9)}', '${U_FORA}', '${ORG2}', 'admin');
INSERT INTO public.whatsapp_instances VALUES ('${A}', '${ORG}'), ('${B}', '${ORG}'), ('${X}', '${ORG2}');
INSERT INTO public.escopo_oculto VALUES ('${C.c3}');
INSERT INTO public.leads(id, organization_id, normalized_phone, name, created_at, sale_responsible_id) VALUES
  ('${id('0e', 1)}', '${ORG}', '${C.c1}', 'Um', now() - interval '9 days', '${TM.mem}'),
  ('${id('0e', 2)}', '${ORG}', '${C.c7}', 'Sete novo', now() - interval '1 day', '${TM.mem}'),
  ('${id('0e', 3)}', '${ORG}', '${C.c7}', 'Sete velho', now() - interval '5 days', '${TM.mem}'),
  ('${id('0e', 4)}', '${ORG}', '${C.c8}', 'Oito', now() - interval '5 days', '${TM.adm}');
INSERT INTO public.channel_messages(organization_id, instance_id, contact_external_id, content, "timestamp",
  direction, sender_name, sender_profile_pic, contact_handle) VALUES
  ('${ORG}', '${A}', '${C.c1}', 'oi', now() - interval '3 hours', 'incoming', 'Cliente Um', 'p1', '@um'),
  ('${ORG}', '${A}', '${C.c1}', 'tudo?', now() - interval '2 hours', 'incoming', 'Cliente Um 2', 'p1b', '@um2'),
  ('${ORG}', '${A}', '${C.c1}', 'resposta', now() - interval '1 hour', 'outgoing', 'NOSSA CONTA', 'nossa', '@nos'),
  ('${ORG}', '${A}', '${C.c2}', 'disparo', now() - interval '50 minutes', 'outgoing', 'NOSSA CONTA', 'nossa', '@nos'),
  ('${ORG}', '${A}', '${C.c3}', 'oculto', now() - interval '40 minutes', 'incoming', 'Tres', 'p3', '@tres'),
  ('${ORG}', '${A}', '${C.c4}', 'na A', now() - interval '30 minutes', 'incoming', 'Quatro', 'p4', '@quatro'),
  ('${ORG}', '${B}', '${C.c4}', 'na B', now() - interval '25 minutes', 'incoming', 'Quatro', 'p4', '@quatro'),
  ('${ORG}', '${B}', '${C.c5}', 'empate', date_trunc('hour', now()) - interval '4 hours', 'incoming', 'Cinco', NULL, NULL),
  ('${ORG}', '${B}', '${C.c6}', 'empate', date_trunc('hour', now()) - interval '4 hours', 'incoming', 'Seis', NULL, NULL),
  ('${ORG}', '${A}', '${C.c7}', 'sete', now() - interval '20 minutes', 'incoming', 'Sete', NULL, NULL),
  ('${ORG}', '${A}', '${C.c8}', 'oito', now() - interval '10 days', 'incoming', 'Oito', NULL, NULL),
  ('${ORG}', '${A}', NULL, 'sem contato', now() - interval '1 minute', 'incoming', 'X', NULL, NULL),
  ('${ORG2}', '${X}', '${C.c1}', 'outra org', now(), 'incoming', 'Fora', NULL, NULL);
INSERT INTO public.conversation_read_state VALUES
  ('${ORG}', '${U.adm}', 'whatsapp_oficial:${B}:${C.c4}', now() - interval '1 minute'),
  ('${ORG}', '${U.mem}', 'whatsapp_oficial:${B}:${C.c4}', now() - interval '1 minute'),
  ('${ORG}', '${U.adm}', 'whatsapp_oficial:${A}:${C.c1}', now() - interval '150 minutes');
`;

// Forma de prod: as 3 relações como views private.* com um recorte de
// verdade (botão): ligado, esconde do MEMBRO o contato c6 — a igualdade
// antiga × nova tem de valer com o recorte cortando linhas.
const PROD_SHAPE = `
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
CREATE TABLE private.knobs (strict boolean NOT NULL DEFAULT false);
INSERT INTO private.knobs DEFAULT VALUES;
GRANT SELECT ON private.knobs TO authenticated;
CREATE FUNCTION private.strict_lead_member_orgs() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT CASE WHEN (SELECT strict FROM private.knobs) AND EXISTS (SELECT 1 FROM public.team_members
    WHERE user_id = auth.uid() AND role <> 'admin') THEN ARRAY['${ORG}'::uuid] ELSE '{}' END $$;
CREATE VIEW private.channel_messages WITH (security_invoker = true) AS
  SELECT * FROM public.channel_messages m
   WHERE NOT (m.organization_id = ANY((SELECT private.strict_lead_member_orgs())::uuid[]))
      OR m.contact_external_id IS DISTINCT FROM '${C.c6}';
CREATE VIEW private.conversation_read_state WITH (security_invoker = true) AS SELECT * FROM public.conversation_read_state;
CREATE VIEW private.leads WITH (security_invoker = true) AS SELECT * FROM public.leads;
`;

const PROD_ACL = `
REVOKE ALL ON FUNCTION ${SIG} FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ${SIG} TO authenticated;
`;

async function db({ prodShape = true, strict = false } = {}) {
  const pg = new PGlite();
  await pg.exec(SKELETON);
  if (prodShape) await pg.exec(PROD_SHAPE);
  if (strict) await pg.exec('UPDATE private.knobs SET strict = true');
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
      `SELECT * FROM public.get_official_whatsapp_conversation_list_multi(
         p_org => $1, p_instances => $2::uuid[], p_limit => $3, p_before => $4::timestamptz,
         p_before_instance => $5::uuid, p_before_contact => $6)`,
      [ORG, args.instances ?? null, args.limit ?? 50, args.before ?? null,
        args.beforeInstance ?? null, args.beforeContact ?? null],
    );
    return r.rows;
  } finally {
    await pg.exec('RESET ROLE');
    await pg.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

const SCENARIOS = {
  padrao: {},
  limite2: { limit: 2 },
  limite1: { limit: 1 },
  caixaB: { instances: [B] },
  caixaInexistente: { instances: [X] },
};

async function snapshot(pg) {
  const out = {};
  for (const [who, user] of Object.entries(U)) {
    for (const [name, args] of Object.entries(SCENARIOS)) out[`${who}/${name}`] = await call(pg, user, args);
    // Página 2 pelo cursor composto, com a borda caindo no empate c5/c6.
    const all = await call(pg, user);
    const i = all.findIndex((r) => r.contact_external_id === C.c5 || r.contact_external_id === C.c6);
    const borda = all[i];
    out[`${who}/pagina2`] = await call(pg, user, {
      limit: 3, before: borda.last_message_time, beforeInstance: borda.instance_id, beforeContact: borda.contact_external_id,
    });
    out[`${who}/cursorParcial`] = await call(pg, user, { before: borda.last_message_time });
  }
  return out;
}

for (const strict of [false, true]) {
  test(`a: mesma saída da função viva de prod (recorte strict ${strict ? 'ligado' : 'desligado'})`, async () => {
    const pg = await db({ strict });
    await pg.exec(RB);
    await pg.exec(PROD_ACL);
    const antes = await snapshot(pg);
    await pg.exec(MIG);
    const depois = await snapshot(pg);
    for (const k of Object.keys(antes)) assert.deepEqual(depois[k], antes[k], `cenário ${k}`);

    // O conjunto exercita o que diz.
    const adm = Object.fromEntries(antes['adm/padrao'].map((r) => [`${r.instance_id}:${r.contact_external_id}`, r]));
    assert.equal(adm[`${A}:${C.c1}`].last_message_direction, 'outgoing');
    assert.equal(adm[`${A}:${C.c1}`].sender_name, 'Cliente Um 2', 'nome da última RECEBIDA');
    assert.equal(adm[`${A}:${C.c1}`].unread_count, 1, 'leitura no meio: 1 depois');
    assert.equal(adm[`${A}:${C.c2}`].sender_name, null, 'só saída: sem identidade');
    assert.equal(adm[`${A}:${C.c4}`].unread_count, 1, 'c4 na A: leitura da B não zera a A');
    assert.equal(adm[`${B}:${C.c4}`].unread_count, 0, 'c4 na B: lida');
    assert.equal(adm[`${A}:${C.c7}`].lead_name, 'Sete velho', 'telefone repetido: o lead mais antigo');
    assert.equal(adm[`${A}:${C.c8}`].unread_count, 0, 'fora dos 7 dias');
    assert.equal(adm[`${A}:${C.c8}`].lead_name, 'Oito');
    assert.ok(adm[`${A}:${C.c3}`], 'admin vê c3');
    const mem = antes['mem/padrao'];
    assert.ok(!mem.some((r) => r.contact_external_id === C.c3), 'escopo esconde c3 do membro');
    assert.equal(mem.find((r) => r.contact_external_id === C.c8).lead_name, null, 'lead que o membro não lê');
    assert.equal(mem.some((r) => r.contact_external_id === C.c6), !strict, 'recorte strict esconde c6');
    assert.ok(!antes['adm/padrao'].some((r) => r.contact_external_id === null), 'sem contato fica fora');
    assert.ok(antes['adm/pagina2'].length > 0, 'página 2 não vazia');
    assert.equal(antes['adm/limite1'].length, 1);
    assert.deepEqual(antes['adm/caixaInexistente'], []);
  });
}

test('b: escopo avaliado por CONVERSA e só até a página encher', async () => {
  const pg = await db();
  await pg.exec(RB);
  const conta = async (fn) => {
    const a = (await pg.query(`SELECT nextval('public.chamadas_escopo') AS v`)).rows[0].v;
    await fn();
    return Number((await pg.query(`SELECT nextval('public.chamadas_escopo') AS v`)).rows[0].v) - Number(a) - 1;
  };
  const antigoTudo = await conta(() => call(pg, U.mem));
  await pg.exec(MIG);
  const novoTudo = await conta(() => call(pg, U.mem));
  const novoUm = await conta(() => call(pg, U.mem, { limit: 1 }));
  const conversas = 9; // (caixa, contato) na ORG; 11 mensagens com contato
  assert.ok(antigoTudo >= conversas, `antiga: ${antigoTudo} chamadas`);
  assert.equal(novoTudo, conversas, 'nova: uma por conversa');
  assert.equal(novoUm, 1, 'nova, LIMIT 1: para na primeira visível');
});

test('c: forma de prod (3 relações em private.*, 5 ocorrências) e forma do repo (roda sem trocar)', async () => {
  const pg = await db();
  await pg.exec(RB);
  await pg.exec(MIG);
  const def = (await pg.query(`SELECT pg_get_functiondef('${SIG}'::regprocedure) AS d`)).rows[0].d;
  const sobra = def.match(new RegExp(`public\\.(${RELS.join('|')})(?![A-Za-z0-9_])`, 'g')) ?? [];
  assert.deepEqual(sobra, []);
  assert.equal((def.match(/private\./g) ?? []).length, 5);

  const repo = await db({ prodShape: false });
  await repo.exec(MIG);
  const d2 = (await repo.query(`SELECT pg_get_functiondef('${SIG}'::regprocedure) AS d`)).rows[0].d;
  assert.ok(!/private\./.test(d2), 'sem recorte instalado, nada vai para private');
  const rows = await call(repo, U.adm);
  assert.ok(rows.length >= 8);
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
