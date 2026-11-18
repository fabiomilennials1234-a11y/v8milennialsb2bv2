// jrtex_visible_chat_keys sem laço aninhado (20280119050000_jrtex_visible_chat_keys_semijoin.sql).
//
// A função só existe em prod. Aqui ela é recriada a partir do CORPO ANTIGO (o que o
// rollback restaura) num PGlite com as tabelas que ela lê e stubs neutros das
// funções JR Tex de que depende, e a migration troca o corpo. O que se prova:
//   a. o CONJUNTO de chaves é igual antes e depois, para cada perfil (membro dono,
//      co-dono, dono pela entrada de funil, escopo de funil JR Tex, Izadora, Karine,
//      usuário sem nada, sem login) — e os conjuntos não são triviais;
//   b. reaplicar é no-op; o rollback devolve o corpo antigo (md5) e o mesmo conjunto;
//   c. corpo vivo divergente → a migration ABORTA e nada muda;
//   d. banco só do repo (sem a função) → no-op nas duas direções.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const MIG = read('../../supabase/migrations/20280119050000_jrtex_visible_chat_keys_semijoin.sql');
const RB = read('../../supabase/migrations/rollback/20280119050000_jrtex_visible_chat_keys_semijoin.sql');
const md5 = (s) => createHash('md5').update(s).digest('hex');
const OLD_MD5 = '5215a7eb7308647988718b838e50db2b';
const NEW_MD5 = '66550eb8ed128999fb48fc4d00e7bd6b';
const OLD_DEF = RB.match(/EXECUTE \$def\$([\s\S]*?)\$def\$;/)[1];
const NEW_DEF = MIG.match(/EXECUTE \$def\$([\s\S]*?)\$def\$;/)[1];

const ORG = '30bb5c27-88f4-4f91-9493-835405ae2e11';
const OUTRA = '11111111-1111-1111-1111-111111111111';
const KARINE = '85f5c2cd-dbf9-4de5-9d35-24ebd9da71ea';
const BOX_KARINE = '859ee852-2102-4a5d-b249-98a6fe0b601c';
const id = (p, n) => `${p}000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`;
const U = { mem: id('0b', 1), out: id('0b', 2), jr: id('0b', 3), iza: id('0b', 4), kar: KARINE, co: id('0b', 6), pipe: id('0b', 7) };
const TM = { mem: id('0c', 1), out: id('0c', 2), jr: id('0c', 3), iza: id('0c', 4), kar: id('0c', 5), co: id('0c', 6), pipe: id('0c', 7) };
const L = { dono: id('0e', 1), co: id('0e', 2), pipe: id('0e', 3), jr: id('0e', 4), alheio: id('0e', 5), apagado: id('0e', 6), outra: id('0e', 7), semfone: id('0e', 8) };
const P = { dono: '5548900000001', co: '5548900000002', pipe: '5548900000003', jr: '5548900000004', alheio: '5548900000005',
  apagado: '5548900000006', outra: '5548900000007', orfaoIza: '5548900000008', orfaoKar: '5548900000009', orfaoMem: '5548900000010',
  semDono: '5548900000011', canal: '5548900000012' };

const SKELETON = `
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
CREATE FUNCTION public.normalize_brazilian_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '') $$;

CREATE TABLE public.team_members (id uuid PRIMARY KEY, user_id uuid, organization_id uuid, is_active boolean NOT NULL DEFAULT true, role text DEFAULT 'member');
CREATE TABLE public.leads (id uuid PRIMARY KEY, organization_id uuid, normalized_phone text, deleted_at timestamptz,
  pre_sale_responsible_id uuid, sale_responsible_id uuid, sdr_id uuid, closer_id uuid);
CREATE TABLE public.lead_owners (lead_id uuid, organization_id uuid, team_member_id uuid, role text);
CREATE TABLE public.pipelines (id uuid PRIMARY KEY, organization_id uuid, name text);
CREATE TABLE public.pipeline_entries (lead_id uuid, organization_id uuid, pipeline_id uuid, assigned_to uuid, metadata jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.whatsapp_messages (organization_id uuid, lead_id uuid, normalized_phone text);
CREATE TABLE public.whatsapp_conversation_summary (organization_id uuid, instance_id uuid, normalized_phone text, lead_id uuid, is_group boolean NOT NULL DEFAULT false);
CREATE TABLE public.channel_messages (organization_id uuid, lead_id uuid, phone_number text, contact_external_id text);
CREATE TABLE public.conversation_read_state (organization_id uuid, conversation_key text);
CREATE TABLE public.whatsapp_conversations (organization_id uuid, normalized_phone text);

CREATE SCHEMA private;
-- Funções JR Tex de prod, em forma neutra (o que importa aqui é o corpo da função sob teste).
CREATE TABLE private.knobs (jr_user uuid, iza_user uuid, iza_phone text, kar_phones text[]);
INSERT INTO private.knobs VALUES ('${U.jr}', '${U.iza}', '${P.orfaoIza}', ARRAY['${P.orfaoKar}']);
CREATE FUNCTION private.jrtex_lead_scope_for_user(p_user uuid, p_org uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_user = (SELECT jr_user FROM private.knobs) THEN 'jrtex' END $$;
CREATE FUNCTION private.jrtex_izadora_inbox_scope(p_user uuid, p_org uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_user = (SELECT iza_user FROM private.knobs) $$;
CREATE FUNCTION private.jrtex_izadora_new_chat(p_user uuid, p_org uuid, p_lead uuid, p_phone text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_lead IS NULL AND p_phone = (SELECT iza_phone FROM private.knobs) $$;
CREATE FUNCTION private.jrtex_karine_orphan_chat(p_user uuid, p_org uuid, p_lead uuid, p_phone text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_lead IS NULL AND (SELECT p_phone = ANY(kar_phones) FROM private.knobs) $$;

INSERT INTO public.team_members(id, user_id, organization_id) VALUES
  ('${TM.mem}', '${U.mem}', '${ORG}'), ('${TM.out}', '${U.out}', '${ORG}'), ('${TM.jr}', '${U.jr}', '${ORG}'),
  ('${TM.iza}', '${U.iza}', '${ORG}'), ('${TM.kar}', '${U.kar}', '${ORG}'), ('${TM.co}', '${U.co}', '${ORG}'), ('${TM.pipe}', '${U.pipe}', '${ORG}');
INSERT INTO public.leads(id, organization_id, normalized_phone, deleted_at, sale_responsible_id) VALUES
  ('${L.dono}', '${ORG}', '${P.dono}', NULL, '${TM.mem}'),
  ('${L.co}', '${ORG}', '${P.co}', NULL, NULL),
  ('${L.pipe}', '${ORG}', '${P.pipe}', NULL, NULL),
  ('${L.jr}', '${ORG}', '${P.jr}', NULL, NULL),
  ('${L.alheio}', '${ORG}', '${P.alheio}', NULL, '${TM.out}'),
  ('${L.apagado}', '${ORG}', '${P.apagado}', now(), '${TM.mem}'),
  ('${L.outra}', '${OUTRA}', '${P.outra}', NULL, '${TM.mem}'),
  ('${L.semfone}', '${ORG}', NULL, NULL, '${TM.mem}');
INSERT INTO public.lead_owners VALUES ('${L.co}', '${ORG}', '${TM.co}', 'co'), ('${L.co}', '${ORG}', '${TM.mem}', 'co');
INSERT INTO public.pipelines VALUES ('${id('0a', 1)}', '${ORG}', 'Funil de Vendas - JRtex'), ('${id('0a', 2)}', '${ORG}', 'Funil Profit');
INSERT INTO public.pipeline_entries(lead_id, organization_id, pipeline_id, assigned_to, metadata) VALUES
  ('${L.pipe}', '${ORG}', '${id('0a', 2)}', NULL, '{"sdr_id": "${TM.pipe}"}'),
  ('${L.jr}', '${ORG}', '${id('0a', 1)}', NULL, '{}'),
  ('${L.alheio}', '${ORG}', '${id('0a', 2)}', '${TM.out}', '{}');

-- Mensagens com pares repetidos, órfãs (sem lead) e telefone formatado diferente.
INSERT INTO public.whatsapp_messages VALUES
  ('${ORG}', '${L.dono}', '${P.dono}'), ('${ORG}', '${L.dono}', '${P.dono}'), ('${ORG}', '${L.co}', '${P.co}'),
  ('${ORG}', '${L.pipe}', '${P.pipe}'), ('${ORG}', '${L.jr}', '${P.jr}'), ('${ORG}', '${L.alheio}', '${P.alheio}'),
  ('${ORG}', '${L.apagado}', '${P.apagado}'), ('${ORG}', NULL, '${P.orfaoIza}'), ('${ORG}', NULL, '${P.orfaoKar}'),
  ('${ORG}', NULL, '${P.orfaoMem}'), ('${ORG}', NULL, '${P.semDono}'), ('${ORG}', NULL, '${P.dono}'), ('${ORG}', NULL, NULL),
  ('${OUTRA}', '${L.outra}', '${P.outra}');
INSERT INTO public.whatsapp_conversation_summary VALUES
  ('${ORG}', '${BOX_KARINE}', '${P.orfaoKar}', NULL, false), ('${ORG}', '${BOX_KARINE}', '${P.orfaoIza}', NULL, false),
  ('${ORG}', '${BOX_KARINE}', '${P.dono}', '${L.dono}', false), ('${ORG}', '${BOX_KARINE}', '${P.co}', '${L.co}', true),
  ('${ORG}', '${id('09', 1)}', '${P.orfaoKar}', NULL, false);
INSERT INTO public.channel_messages VALUES
  ('${ORG}', '${L.dono}', '+55 (48) 90000-0001', NULL), ('${ORG}', NULL, NULL, '${P.canal}'), ('${ORG}', '${L.jr}', NULL, '${P.jr}');
INSERT INTO public.conversation_read_state VALUES
  ('${ORG}', 'whatsapp:${BOX_KARINE}:${P.dono}'), ('${ORG}', 'whatsapp:${BOX_KARINE}:${P.dono}'), ('${ORG}', 'whatsapp:${BOX_KARINE}:+55 48 90000-0003'),
  ('${ORG}', 'whatsapp:${BOX_KARINE}:${P.orfaoKar}'), ('${ORG}', 'chave-sem-padrao'), ('${OUTRA}', 'whatsapp:x:${P.outra}');
INSERT INTO public.whatsapp_conversations VALUES ('${ORG}', '${P.orfaoIza}'), ('${ORG}', '${P.orfaoMem}'), ('${ORG}', NULL);
`;

async function db({ comFuncao = true } = {}) {
  const pg = new PGlite();
  await pg.exec(SKELETON);
  if (comFuncao) await pg.exec(OLD_DEF);
  return pg;
}
const login = (pg, user) => pg.exec(`SELECT set_config('request.jwt.claims', '${user ? JSON.stringify({ sub: user, role: 'authenticated' }) : ''}', false)`);
const chaves = async (pg, user) => {
  await login(pg, user);
  const r = await pg.query(`SELECT private.jrtex_visible_chat_keys() AS k`);
  return [...new Set(r.rows[0].k)].sort();
};
const todos = async (pg) => {
  const out = {};
  for (const [nome, user] of Object.entries({ ...U, semLogin: null })) out[nome] = await chaves(pg, user);
  return out;
};
const src = async (pg) => (await pg.query(`SELECT prosrc FROM pg_proc WHERE oid = 'private.jrtex_visible_chat_keys()'::regprocedure`)).rows[0].prosrc;

test('corpos do teste são os travados na migration', () => {
  assert.equal(md5(OLD_DEF.match(/AS \$function\$([\s\S]*?)\$function\$/)[1]), OLD_MD5);
  assert.equal(md5(NEW_DEF.match(/AS \$function\$([\s\S]*?)\$function\$/)[1]), NEW_MD5);
});

test('a: mesmo conjunto de chaves para todos os perfis, e conjuntos não triviais', async () => {
  const pg = await db();
  const antes = await todos(pg);
  await pg.exec(MIG);
  assert.equal(md5(await src(pg)), NEW_MD5);
  const depois = await todos(pg);
  assert.deepEqual(depois, antes);

  const tem = (perfil, lead, fone) => antes[perfil].some((x) => JSON.parse(x)[0] === lead && JSON.parse(x)[1] === fone);
  assert.ok(tem('mem', L.dono, P.dono), 'dono pelo lead');
  assert.ok(tem('mem', L.co, P.co), 'co-dono');
  assert.ok(tem('co', L.co, P.co), 'co-dono (outro usuário)');
  assert.ok(tem('pipe', L.pipe, P.pipe), 'dono pela entrada de funil (metadata)');
  assert.ok(tem('mem', null, P.dono), 'par sem lead cujo telefone é de lead permitido');
  assert.ok(tem('jr', L.jr, P.jr), 'escopo de funil JR Tex: lead do funil');
  assert.ok(tem('jr', L.jr, P.jr) && !tem('jr', L.dono, P.dono), 'escopo de funil não enxerga lead alheio');
  assert.ok(tem('iza', null, P.orfaoIza), 'Izadora: chat novo sem lead');
  assert.ok(tem('kar', null, P.orfaoKar), 'Karine: órfão da caixa principal');
  assert.ok(!tem('kar', null, P.orfaoIza), 'Karine não vê o órfão da Izadora');
  assert.ok(!tem('mem', L.apagado, P.apagado) && !tem('mem', L.outra, P.outra), 'apagado e de outra org ficam fora');
  assert.ok(tem('mem', null, '5548900000012') === false, 'telefone de canal sem dono não aparece para o membro');
  assert.deepEqual(antes.out.filter((x) => JSON.parse(x)[0] === L.dono), [], 'usuário sem vínculo não vê lead alheio');
  assert.deepEqual(antes.semLogin, [], 'sem login: vazio');
  assert.ok(Object.values(antes).filter((v) => v.length > 0).length >= 6);
});

test('b: reaplicar é no-op; rollback devolve o corpo antigo e o mesmo conjunto', async () => {
  const pg = await db();
  const antes = await todos(pg);
  await pg.exec(MIG);
  const fonte = await src(pg);
  await pg.exec(MIG);
  assert.equal(await src(pg), fonte, 'reaplicar não muda nada');
  await pg.exec(RB);
  assert.equal(md5(await src(pg)), OLD_MD5);
  assert.deepEqual(await todos(pg), antes);
  await pg.exec(RB);
  assert.equal(md5(await src(pg)), OLD_MD5, 'rollback repetido é no-op');
});

test('c: corpo vivo divergente → apply e rollback abortam e nada muda', async () => {
  const pg = await db();
  await pg.exec(`CREATE OR REPLACE FUNCTION private.jrtex_visible_chat_keys() RETURNS text[] LANGUAGE sql STABLE AS $$ SELECT ARRAY['x']::text[] $$`);
  const antes = await src(pg);
  await assert.rejects(pg.exec(MIG), /divergiu do corpo revisado/);
  assert.equal(await src(pg), antes);
  await assert.rejects(pg.exec(RB), /não está no corpo desta migration/);
  assert.equal(await src(pg), antes);
});

test('d: banco só do repo (sem a função) — no-op nas duas direções', async () => {
  const pg = await db({ comFuncao: false });
  await pg.exec(MIG);
  await pg.exec(RB);
  const r = await pg.query(`SELECT to_regprocedure('private.jrtex_visible_chat_keys()') AS f`);
  assert.equal(r.rows[0].f, null);
});
