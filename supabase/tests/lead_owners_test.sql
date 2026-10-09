-- supabase/tests/lead_owners_test.sql
--
-- Chamado 793f4b05 · PR1/5: N donos por lead
-- (migration 20271116000000_lead_owners_n_donos.sql).
--
--   (GR) GRANTs provados por pg_class.relacl / has_*_privilege: authenticated
--        só SELECT em lead_owners; anon nada; RPCs sem EXECUTE para anon;
--        helpers internos sem EXECUTE para clientes.
--   (BF) backfill: grava os principais, ignora org NULL e membro de outra
--        org, mesma pessoa nos dois papéis = 2 linhas; idempotente.
--   (SY) sincronia do principal nos dois sentidos: INSERT e UPDATE em leads;
--        UPDATE que só toca responsible_id (caminho do ERP) também sincroniza.
--   (TR) transferência mantém a anterior como co-dona (padrão) ou não.
--   (ER) ERP/round-robin troca o principal sem apagar manual/transfer;
--        principal canonical substituído some.
--   (CO) co-dono vê e edita o lead; can_update_lead concorda.
--   (NT) neutralidade: dono principal não passa o próprio lead adiante por
--        UPDATE direto sem permissão (WITH CHECK igual a hoje).
--   (XO) membro sem vínculo e membro de OUTRA org não veem.
--   (WR) ninguém escreve direto em lead_owners; anon não executa as RPCs.
--   (MA) master adiciona, transfere e vê.
--   (GU) guarda: membro de outra org não entra nem pela porta dos fundos.
--   (NL) lead com organization_id NULL não quebra o trigger.
--   (INV) invariante: toda coluna canônica (mesma org) tem principal.
--   (FL) gate por org (CTO 09/10): org A tem a flag lead_owners_n_donos e se
--        comporta como acima; org B NÃO tem: trigger não escreve, backfill
--        não toca, RPC recusa (inclusive master), guarda recusa, e a
--        visibilidade/edição de `leads` fica idêntica.
--   (DR) can_update_lead == USING da policy de UPDATE em persona × lead,
--        já com co-donos (FOR KEY SHARE como authenticated).
--
-- Roda inteiro em transação revertida.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

-- ===========================================================================
-- Fixtures (sem triggers: o backfill é quem cria os principais)
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('793f4b05-0000-4000-8000-00000000000a', 'Org OWN A', 'org-own-a', 'America/Sao_Paulo'),
  ('793f4b05-0000-4000-8000-00000000000b', 'Org OWN B', 'org-own-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

-- Org A com a flag (merge, como a migration faz na Café Jurerê); B sem.
UPDATE public.organizations
   SET feature_flags = feature_flags || '{"lead_owners_n_donos": true}'::jsonb
 WHERE id = '793f4b05-0000-4000-8000-00000000000a';
UPDATE public.organizations
   SET feature_flags = feature_flags - 'lead_owners_n_donos'
 WHERE id = '793f4b05-0000-4000-8000-00000000000b';

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
)
SELECT u.id::uuid, u.email, '', now(), '{}'::jsonb, now(), now(),
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       '', '', '', '', '', '', '', ''
  FROM (VALUES
    ('793f4b05-0000-4000-8000-0000000000a1', 'own-admin@test.local'),
    ('793f4b05-0000-4000-8000-0000000000a2', 'own-varejo@test.local'),
    ('793f4b05-0000-4000-8000-0000000000a3', 'own-envase@test.local'),
    ('793f4b05-0000-4000-8000-0000000000a4', 'own-sdr@test.local'),
    ('793f4b05-0000-4000-8000-0000000000a5', 'own-alheio@test.local'),
    ('793f4b05-0000-4000-8000-0000000000a6', 'own-inativo@test.local'),
    ('793f4b05-0000-4000-8000-0000000000b1', 'own-org-b@test.local'),
    ('793f4b05-0000-4000-8000-0000000000b2', 'own-org-b-membro@test.local'),
    ('793f4b05-0000-4000-8000-0000000000c1', 'own-master@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

-- a1 admin · s1 Varejo · s2 Envase · p1 SDR · x1 sem vínculo · i1 inativo · b1 org B
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('793f4b05-0000-4000-8000-0000000001a1', '793f4b05-0000-4000-8000-00000000000a', '793f4b05-0000-4000-8000-0000000000a1', 'Admin A',  'admin',  true),
  ('793f4b05-0000-4000-8000-0000000001a2', '793f4b05-0000-4000-8000-00000000000a', '793f4b05-0000-4000-8000-0000000000a2', 'Varejo A', 'member', true),
  ('793f4b05-0000-4000-8000-0000000001a3', '793f4b05-0000-4000-8000-00000000000a', '793f4b05-0000-4000-8000-0000000000a3', 'Envase A', 'member', true),
  ('793f4b05-0000-4000-8000-0000000001a4', '793f4b05-0000-4000-8000-00000000000a', '793f4b05-0000-4000-8000-0000000000a4', 'SDR A',    'member', true),
  ('793f4b05-0000-4000-8000-0000000001a5', '793f4b05-0000-4000-8000-00000000000a', '793f4b05-0000-4000-8000-0000000000a5', 'Alheio A', 'member', true),
  ('793f4b05-0000-4000-8000-0000000001a6', '793f4b05-0000-4000-8000-00000000000a', '793f4b05-0000-4000-8000-0000000000a6', 'Inativo A','member', false),
  ('793f4b05-0000-4000-8000-0000000001b1', '793f4b05-0000-4000-8000-00000000000b', '793f4b05-0000-4000-8000-0000000000b1', 'Admin B',  'admin',  true),
  ('793f4b05-0000-4000-8000-0000000001b2', '793f4b05-0000-4000-8000-00000000000b', '793f4b05-0000-4000-8000-0000000000b2', 'Membro B', 'member', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (user_id, is_active)
VALUES ('793f4b05-0000-4000-8000-0000000000c1', true);

-- Org A restrita: membro só vê/edita lead pelo qual responde.
INSERT INTO public.organization_feature_defaults (organization_id, feature_key, enabled) VALUES
  ('793f4b05-0000-4000-8000-00000000000a', 'leads.view_all', false),
  ('793f4b05-0000-4000-8000-00000000000a', 'leads.view_unassigned', false),
  ('793f4b05-0000-4000-8000-00000000000a', 'leads.view_subordinates', false),
  ('793f4b05-0000-4000-8000-00000000000b', 'leads.view_all', false),
  ('793f4b05-0000-4000-8000-00000000000b', 'leads.view_unassigned', false),
  ('793f4b05-0000-4000-8000-00000000000b', 'leads.view_subordinates', false);

-- Colunas legadas preenchidas à mão (sem o trigger canônico em replica).
--   L1 venda s1 + pré p1 · L2 venda s1 · L3 sem dono · L4 venda s2
--   L6 venda s1 com closer NULL (o caso dos 3.952 do ERP)
--   L7 s1 nos dois papéis · LX venda b1 (outra org, legado) · LN org NULL
--   LB org B venda b1 · LB2 org B venda b2 (membro restrito, org sem flag)
INSERT INTO public.leads (id, organization_id, name, origin, sale_responsible_id, closer_id, responsible_id, pre_sale_responsible_id, sdr_id, created_at) VALUES
  ('793f4b05-0000-4000-8000-0000000002a1', '793f4b05-0000-4000-8000-00000000000a', 'L1', 'meta_ads', '793f4b05-0000-4000-8000-0000000001a2', '793f4b05-0000-4000-8000-0000000001a2', NULL, '793f4b05-0000-4000-8000-0000000001a4', '793f4b05-0000-4000-8000-0000000001a4', now()),
  ('793f4b05-0000-4000-8000-0000000002a2', '793f4b05-0000-4000-8000-00000000000a', 'L2', 'meta_ads', '793f4b05-0000-4000-8000-0000000001a2', '793f4b05-0000-4000-8000-0000000001a2', NULL, NULL, NULL, now()),
  ('793f4b05-0000-4000-8000-0000000002a3', '793f4b05-0000-4000-8000-00000000000a', 'L3', 'meta_ads', NULL, NULL, NULL, NULL, NULL, now()),
  ('793f4b05-0000-4000-8000-0000000002a4', '793f4b05-0000-4000-8000-00000000000a', 'L4', 'meta_ads', '793f4b05-0000-4000-8000-0000000001a3', '793f4b05-0000-4000-8000-0000000001a3', NULL, NULL, NULL, now()),
  ('793f4b05-0000-4000-8000-0000000002a6', '793f4b05-0000-4000-8000-00000000000a', 'L6', 'erp',      '793f4b05-0000-4000-8000-0000000001a2', NULL, '793f4b05-0000-4000-8000-0000000001a2', NULL, NULL, now()),
  ('793f4b05-0000-4000-8000-0000000002a7', '793f4b05-0000-4000-8000-00000000000a', 'L7', 'meta_ads', '793f4b05-0000-4000-8000-0000000001a2', '793f4b05-0000-4000-8000-0000000001a2', NULL, '793f4b05-0000-4000-8000-0000000001a2', '793f4b05-0000-4000-8000-0000000001a2', now()),
  ('793f4b05-0000-4000-8000-0000000002a8', '793f4b05-0000-4000-8000-00000000000a', 'LX', 'meta_ads', '793f4b05-0000-4000-8000-0000000001b1', '793f4b05-0000-4000-8000-0000000001b1', NULL, NULL, NULL, now()),
  ('793f4b05-0000-4000-8000-0000000002a9', NULL,                                   'LN', 'meta_ads', '793f4b05-0000-4000-8000-0000000001a2', '793f4b05-0000-4000-8000-0000000001a2', NULL, NULL, NULL, now()),
  ('793f4b05-0000-4000-8000-0000000002b1', '793f4b05-0000-4000-8000-00000000000b', 'LB', 'meta_ads', '793f4b05-0000-4000-8000-0000000001b1', '793f4b05-0000-4000-8000-0000000001b1', NULL, NULL, NULL, now()),
  ('793f4b05-0000-4000-8000-0000000002b2', '793f4b05-0000-4000-8000-00000000000b', 'LB2', 'meta_ads', '793f4b05-0000-4000-8000-0000000001b2', '793f4b05-0000-4000-8000-0000000001b2', NULL, NULL, NULL, now())
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

-- Retrato dos donos de um lead, lido como dono do banco (sem RLS).
CREATE FUNCTION pg_temp.donos(p_lead uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(string_agg(
           right(o.team_member_id::text, 2) || ':' || o.role || ':' || o.source,
           ',' ORDER BY o.role, o.team_member_id), '')
    FROM public.lead_owners o WHERE o.lead_id = p_lead
$$;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

-- ===========================================================================
-- (GR) grants
-- ===========================================================================
SELECT ok(has_table_privilege('authenticated', 'public.lead_owners', 'SELECT'),
  'GR1: authenticated lê lead_owners (a RLS decide o quê)');
SELECT ok(NOT has_table_privilege('authenticated', 'public.lead_owners', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.lead_owners', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.lead_owners', 'DELETE')
      AND NOT has_table_privilege('authenticated', 'public.lead_owners', 'TRUNCATE'),
  'GR2: authenticated não tem INSERT/UPDATE/DELETE/TRUNCATE em lead_owners');
SELECT ok(NOT has_table_privilege('anon', 'public.lead_owners', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.lead_owners', 'INSERT'),
  'GR3: anon não tem nada em lead_owners');
SELECT is(
  (SELECT count(*)::int FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.oid = 'public.lead_owners'::regclass
      AND a.grantee IN (0, (SELECT oid FROM pg_roles WHERE rolname = 'anon'))),
  0, 'GR4: relacl de lead_owners não tem entrada para PUBLIC nem anon');
SELECT ok(NOT has_function_privilege('anon', 'public.lead_owner_add(uuid, uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.lead_owner_remove(uuid, uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.lead_owner_transfer(uuid, uuid, text, boolean)', 'EXECUTE'),
  'GR5: anon não executa as RPCs');
SELECT ok(has_function_privilege('authenticated', 'public.lead_owner_add(uuid, uuid)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.lead_owner_transfer(uuid, uuid, text, boolean)', 'EXECUTE'),
  'GR6: authenticated executa as RPCs');
SELECT ok(NOT has_function_privilege('authenticated', 'public.lead_owners_backfill(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.lead_owners_enabled(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.lead_owners_enabled(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.lead_owner_authorize(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.can_update_lead(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.rls_lead_co_owned(uuid, uuid[])', 'EXECUTE'),
  'GR7: helpers internos fechados para clientes');

-- ===========================================================================
-- (BF) backfill
-- ===========================================================================
SELECT throws_ok(
  $q$SELECT public.lead_owners_backfill('793f4b05-0000-4000-8000-00000000000b')$q$,
  'PT403', 'N donos por lead não está ativo nesta organização.',
  'FL1: backfill explícito de org SEM a flag é recusado');
SELECT is(public.lead_owners_backfill('793f4b05-0000-4000-8000-00000000000a'), 7,
  'BF1: backfill da org A grava 7 principais (L1×2, L2, L4, L6, L7×2); ignora LX (outra org), LN (org NULL), L3 (sem dono)');
SELECT is(public.lead_owners_backfill(), 0,
  'FL2: backfill de "todas as orgs com flag" não toca a org B (LB, LB2 seguem sem linha)');
SELECT is((SELECT count(*)::int FROM public.lead_owners WHERE organization_id = '793f4b05-0000-4000-8000-00000000000b'), 0,
  'FL3: nenhuma linha da org sem flag');
SELECT is(public.lead_owners_backfill(), 0, 'BF2: segunda volta não grava nada (idempotente)');
SELECT is(pg_temp.donos('793f4b05-0000-4000-8000-0000000002a7'), 'a2:pre_venda:backfill,a2:venda:backfill',
  'BF3: mesma pessoa nos dois papéis = uma linha principal por papel');
SELECT is(pg_temp.donos('793f4b05-0000-4000-8000-0000000002a8'), '',
  'BF4: dono de outra org (legado) não entra');

-- ===========================================================================
-- (SY) sincronia
-- ===========================================================================
UPDATE public.leads SET sale_responsible_id = '793f4b05-0000-4000-8000-0000000001a3'
 WHERE id = '793f4b05-0000-4000-8000-0000000002a2';
SELECT is(pg_temp.donos('793f4b05-0000-4000-8000-0000000002a2'), 'a3:venda:canonical',
  'SY1: UPDATE da coluna troca o principal; o anterior (backfill) sai');

INSERT INTO public.leads (id, organization_id, name, origin, sale_responsible_id)
VALUES ('793f4b05-0000-4000-8000-0000000002a5', '793f4b05-0000-4000-8000-00000000000a', 'L5', 'meta_ads', '793f4b05-0000-4000-8000-0000000001a2');
SELECT is(pg_temp.donos('793f4b05-0000-4000-8000-0000000002a5'), 'a2:venda:canonical',
  'SY2: INSERT em leads cria o principal');

-- Caminho do ERP: o SET só toca responsible_id; quem muda sale_responsible_id
-- é o BEFORE trigger canônico (closer_id NULL).
UPDATE public.leads SET responsible_id = '793f4b05-0000-4000-8000-0000000001a3'
 WHERE id = '793f4b05-0000-4000-8000-0000000002a6';
SELECT is(
  (SELECT sale_responsible_id FROM public.leads WHERE id = '793f4b05-0000-4000-8000-0000000002a6'),
  '793f4b05-0000-4000-8000-0000000001a3'::uuid,
  'SY3a: (pré-condição) o trigger canônico reescreveu sale_responsible_id');
SELECT is(pg_temp.donos('793f4b05-0000-4000-8000-0000000002a6'), 'a3:venda:canonical',
  'SY3b: e lead_owners acompanhou, mesmo sem a coluna no SET');

UPDATE public.leads SET pre_sale_responsible_id = NULL
 WHERE id = '793f4b05-0000-4000-8000-0000000002a1';
SELECT is(pg_temp.donos('793f4b05-0000-4000-8000-0000000002a1'), 'a2:venda:backfill',
  'SY4: coluna zerada tira o principal do papel');
UPDATE public.leads SET pre_sale_responsible_id = '793f4b05-0000-4000-8000-0000000001a4'
 WHERE id = '793f4b05-0000-4000-8000-0000000002a1';

-- ===========================================================================
-- (XO) antes de qualquer co-dono: sem vínculo e outra org não veem
-- ===========================================================================
SELECT pg_temp.as_user('793f4b05-0000-4000-8000-0000000000a5');
SET LOCAL role authenticated;
SELECT is((SELECT count(*)::int FROM public.leads WHERE id = '793f4b05-0000-4000-8000-0000000002a1'), 0,
  'XO1: membro sem vínculo não vê L1');
SELECT is((SELECT count(*)::int FROM public.lead_owners WHERE lead_id = '793f4b05-0000-4000-8000-0000000002a1'), 0,
  'XO2: nem os donos de L1');
SELECT throws_ok(
  $q$SELECT public.lead_owner_add('793f4b05-0000-4000-8000-0000000002a1', '793f4b05-0000-4000-8000-0000000001a5')$q$,
  '42501', NULL, 'XO3: membro sem vínculo não se põe como dono');
RESET role;

SELECT pg_temp.as_user('793f4b05-0000-4000-8000-0000000000b1');
SET LOCAL role authenticated;
SELECT is((SELECT count(*)::int FROM public.lead_owners WHERE organization_id = '793f4b05-0000-4000-8000-00000000000a'), 0,
  'XO4: admin de OUTRA org não vê nenhum dono da org A');
SELECT throws_ok(
  $q$SELECT public.lead_owner_add('793f4b05-0000-4000-8000-0000000002a1', '793f4b05-0000-4000-8000-0000000001b1')$q$,
  'PT404', NULL, 'XO5: e não alcança o lead (404, não revela que existe)');
RESET role;

-- ===========================================================================
-- (WR) escrita direta
-- ===========================================================================
SELECT pg_temp.as_user('793f4b05-0000-4000-8000-0000000000a1');
SET LOCAL role authenticated;
SELECT throws_ok(
  $q$INSERT INTO public.lead_owners (organization_id, lead_id, team_member_id, role, is_primary, source)
     VALUES ('793f4b05-0000-4000-8000-00000000000a', '793f4b05-0000-4000-8000-0000000002a3',
             '793f4b05-0000-4000-8000-0000000001a1', 'co', false, 'manual')$q$,
  '42501', NULL, 'WR1: nem admin insere direto em lead_owners');
SELECT throws_ok($q$UPDATE public.lead_owners SET source = 'manual'$q$, '42501', NULL, 'WR2: nem atualiza');
SELECT throws_ok($q$DELETE FROM public.lead_owners$q$, '42501', NULL, 'WR3: nem apaga');
RESET role;

SET LOCAL role anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT throws_ok(
  $q$SELECT public.lead_owner_add('793f4b05-0000-4000-8000-0000000002a1', '793f4b05-0000-4000-8000-0000000001a5')$q$,
  '42501', NULL, 'WR4: anon não executa a RPC');
SELECT throws_ok($q$SELECT count(*) FROM public.lead_owners$q$, '42501', NULL, 'WR5: anon não lê lead_owners');
RESET role;

-- ===========================================================================
-- (TR) transferência Varejo → Envase pela própria dona (s1 em L1)
-- ===========================================================================
SELECT pg_temp.as_user('793f4b05-0000-4000-8000-0000000000a2');
SET LOCAL role authenticated;
SELECT lives_ok(
  $q$SELECT public.lead_owner_transfer('793f4b05-0000-4000-8000-0000000002a1', '793f4b05-0000-4000-8000-0000000001a3', 'venda')$q$,
  'TR1: dona transfere o lead (manter anterior = padrão)');
RESET role;
SELECT is(pg_temp.donos('793f4b05-0000-4000-8000-0000000002a1'),
  'a2:co:transfer,a4:pre_venda:canonical,a3:venda:transfer',
  'TR2: nova é principal (transfer), anterior vira co-dona, pré-venda intacta');
SELECT is(
  (SELECT closer_id FROM public.leads WHERE id = '793f4b05-0000-4000-8000-0000000002a1'),
  '793f4b05-0000-4000-8000-0000000001a3'::uuid,
  'TR3: a coluna legada closer_id foi espelhada (comissão/métricas seguem o principal)');

-- (CO) a anterior continua vendo e editando
SELECT pg_temp.as_user('793f4b05-0000-4000-8000-0000000000a2');
SET LOCAL role authenticated;
SELECT is((SELECT count(*)::int FROM public.leads WHERE id = '793f4b05-0000-4000-8000-0000000002a1'), 1,
  'CO1: co-dona vê o lead');
SELECT is((SELECT count(*)::int FROM public.lead_owners WHERE lead_id = '793f4b05-0000-4000-8000-0000000002a1'), 3,
  'CO2: e todos os donos dele');
WITH u AS (UPDATE public.leads SET name = 'L1 editado' WHERE id = '793f4b05-0000-4000-8000-0000000002a1' RETURNING 1)
SELECT is(count(*)::int, 1, 'CO3: co-dona edita o lead (UPDATE casa a linha)') FROM u;
RESET role;
-- claims ainda da co-dona; a função roda como dono do banco (DEFINER).
SELECT ok(public.can_update_lead('793f4b05-0000-4000-8000-0000000002a1'),
  'CO4: can_update_lead concorda (co-dona pode editar)');

-- (NT) neutralidade do WITH CHECK: dono principal canonical não passa o lead
-- adiante por UPDATE direto sem permissão (igual a hoje).
SELECT pg_temp.as_user('793f4b05-0000-4000-8000-0000000000a2');
SET LOCAL role authenticated;
SELECT throws_ok(
  $q$UPDATE public.leads SET sale_responsible_id = '793f4b05-0000-4000-8000-0000000001a3'
      WHERE id = '793f4b05-0000-4000-8000-0000000002a5'$q$,
  '42501', NULL, 'NT1: UPDATE direto que tira o lead de si continua recusado pela RLS');
RESET role;

-- Sem manter a anterior.
SELECT pg_temp.as_user('793f4b05-0000-4000-8000-0000000000a1');
SET LOCAL role authenticated;
SELECT lives_ok(
  $q$SELECT public.lead_owner_transfer('793f4b05-0000-4000-8000-0000000002a4', '793f4b05-0000-4000-8000-0000000001a2', 'venda', false)$q$,
  'TR4: admin transfere sem manter a anterior');
RESET role;
SELECT is(pg_temp.donos('793f4b05-0000-4000-8000-0000000002a4'), 'a2:venda:transfer',
  'TR5: a anterior sai por completo');

-- Mesma pessoa nos dois papéis: transferir a venda não cria co redundante.
SELECT pg_temp.as_user('793f4b05-0000-4000-8000-0000000000a1');
SET LOCAL role authenticated;
SELECT lives_ok(
  $q$SELECT public.lead_owner_transfer('793f4b05-0000-4000-8000-0000000002a7', '793f4b05-0000-4000-8000-0000000001a3', 'venda')$q$,
  'TR6: transfere a venda de quem também é pré-venda');
RESET role;
SELECT is(pg_temp.donos('793f4b05-0000-4000-8000-0000000002a7'), 'a2:pre_venda:backfill,a3:venda:transfer',
  'TR7: quem continua principal no outro papel não ganha linha co duplicada');

SELECT pg_temp.as_user('793f4b05-0000-4000-8000-0000000000a1');
SET LOCAL role authenticated;
SELECT throws_ok(
  $q$SELECT public.lead_owner_transfer('793f4b05-0000-4000-8000-0000000002a1', '793f4b05-0000-4000-8000-0000000001a3', 'co')$q$,
  'PT422', NULL, 'TR8: papel inválido');
RESET role;

-- ===========================================================================
-- (ER) ERP / round-robin trocam o principal (UPDATE de backend na coluna)
-- ===========================================================================
UPDATE public.leads SET sale_responsible_id = '793f4b05-0000-4000-8000-0000000001a1'
 WHERE id = '793f4b05-0000-4000-8000-0000000002a1';
SELECT is(pg_temp.donos('793f4b05-0000-4000-8000-0000000002a1'),
  'a2:co:transfer,a3:co:transfer,a4:pre_venda:canonical,a1:venda:canonical',
  'ER1: principal transfer vira co-dono; co-dono anterior fica; novo principal entra');

UPDATE public.leads SET sale_responsible_id = '793f4b05-0000-4000-8000-0000000001a3'
 WHERE id = '793f4b05-0000-4000-8000-0000000002a1';
SELECT is(pg_temp.donos('793f4b05-0000-4000-8000-0000000002a1'),
  'a2:co:transfer,a4:pre_venda:canonical,a3:venda:canonical',
  'ER2: principal canonical substituído some; co-dono promovido perde a linha co (sem duplicata)');

-- ===========================================================================
-- (AD/RM) adicionar e remover co-dono
-- ===========================================================================
SELECT pg_temp.as_user('793f4b05-0000-4000-8000-0000000000a1');
SET LOCAL role authenticated;
SELECT lives_ok(
  $q$SELECT public.lead_owner_add('793f4b05-0000-4000-8000-0000000002a1', '793f4b05-0000-4000-8000-0000000001a5')$q$,
  'AD1: admin adiciona co-dono');
SELECT lives_ok(
  $q$SELECT public.lead_owner_add('793f4b05-0000-4000-8000-0000000002a1', '793f4b05-0000-4000-8000-0000000001a5')$q$,
  'AD2: adicionar de novo não falha');
SELECT throws_ok(
  $q$SELECT public.lead_owner_add('793f4b05-0000-4000-8000-0000000002a1', '793f4b05-0000-4000-8000-0000000001b1')$q$,
  'PT422', NULL, 'AD3: membro de outra org recusado');
SELECT throws_ok(
  $q$SELECT public.lead_owner_add('793f4b05-0000-4000-8000-0000000002a1', '793f4b05-0000-4000-8000-0000000001a6')$q$,
  'PT422', NULL, 'AD4: membro inativo recusado');
SELECT throws_ok(
  $q$SELECT public.lead_owner_remove('793f4b05-0000-4000-8000-0000000002a1', '793f4b05-0000-4000-8000-0000000001a3')$q$,
  'PT409', NULL, 'RM1: principal não sai por remove (use a transferência)');
RESET role;
SELECT is(
  (SELECT count(*)::int FROM public.lead_owners
    WHERE lead_id = '793f4b05-0000-4000-8000-0000000002a1' AND team_member_id = '793f4b05-0000-4000-8000-0000000001a5'),
  1, 'AD5: uma linha só para o co-dono adicionado duas vezes');

SELECT pg_temp.as_user('793f4b05-0000-4000-8000-0000000000a5');
SET LOCAL role authenticated;
SELECT is((SELECT count(*)::int FROM public.leads WHERE id = '793f4b05-0000-4000-8000-0000000002a1'), 1,
  'CO5: o membro antes sem vínculo agora vê L1 como co-dono');
SELECT is((SELECT count(*)::int FROM public.leads WHERE id = '793f4b05-0000-4000-8000-0000000002a3'), 0,
  'CO6: e continua sem ver lead do qual não é dono');
SELECT lives_ok(
  $q$SELECT public.lead_owner_remove('793f4b05-0000-4000-8000-0000000002a1', '793f4b05-0000-4000-8000-0000000001a5')$q$,
  'RM2: co-dono pode sair (pode editar o lead)');
SELECT is((SELECT count(*)::int FROM public.leads WHERE id = '793f4b05-0000-4000-8000-0000000002a1'), 0,
  'RM3: e ao sair deixa de ver o lead');
RESET role;

-- ===========================================================================
-- (MA) master
-- ===========================================================================
SELECT pg_temp.as_user('793f4b05-0000-4000-8000-0000000000c1');
SET LOCAL role authenticated;
SELECT throws_ok(
  $q$SELECT public.lead_owner_add('793f4b05-0000-4000-8000-0000000002b1', '793f4b05-0000-4000-8000-0000000001b2')$q$,
  'PT403', 'N donos por lead não está ativo nesta organização.',
  'MA1: nem master escreve donos em org SEM a flag');
SELECT lives_ok(
  $q$SELECT public.lead_owner_add('793f4b05-0000-4000-8000-0000000002a3', '793f4b05-0000-4000-8000-0000000001a5')$q$,
  'MA2: master adiciona co-dono em lead sem dono');
SELECT lives_ok(
  $q$SELECT public.lead_owner_transfer('793f4b05-0000-4000-8000-0000000002a3', '793f4b05-0000-4000-8000-0000000001a2', 'venda')$q$,
  'MA3: master transfere');
SELECT ok((SELECT count(*) FROM public.lead_owners WHERE lead_id = '793f4b05-0000-4000-8000-0000000002a3') = 2,
  'MA4: master vê os donos');
RESET role;
SELECT is(pg_temp.donos('793f4b05-0000-4000-8000-0000000002a3'), 'a5:co:manual,a2:venda:transfer',
  'MA5: resultado do master no banco');

-- ===========================================================================
-- (GU) guarda da tabela e (NL) org NULL
-- ===========================================================================
SELECT throws_ok(
  $q$INSERT INTO public.lead_owners (organization_id, lead_id, team_member_id, role, is_primary, source)
     VALUES ('793f4b05-0000-4000-8000-00000000000a', '793f4b05-0000-4000-8000-0000000002a3',
             '793f4b05-0000-4000-8000-0000000001b1', 'co', false, 'manual')$q$,
  'P0001', NULL, 'GU1: membro de outra org recusado até para o dono do banco');
SELECT throws_ok(
  $q$INSERT INTO public.lead_owners (organization_id, lead_id, team_member_id, role, is_primary, source)
     VALUES ('793f4b05-0000-4000-8000-00000000000b', '793f4b05-0000-4000-8000-0000000002a3',
             '793f4b05-0000-4000-8000-0000000001b1', 'co', false, 'manual')$q$,
  'P0001', NULL, 'GU2: org da linha diferente da org do lead recusada');
SELECT throws_ok(
  $q$INSERT INTO public.lead_owners (organization_id, lead_id, team_member_id, role, is_primary, source)
     VALUES ('793f4b05-0000-4000-8000-00000000000a', '793f4b05-0000-4000-8000-0000000002a3',
             '793f4b05-0000-4000-8000-0000000001a4', 'co', true, 'manual')$q$,
  '23514', NULL, 'GU3: co-dono nunca é principal (CHECK)');

SELECT lives_ok(
  $q$UPDATE public.leads SET sale_responsible_id = '793f4b05-0000-4000-8000-0000000001a3'
      WHERE id = '793f4b05-0000-4000-8000-0000000002a9'$q$,
  'NL1: UPDATE em lead com organization_id NULL não quebra');
SELECT is(pg_temp.donos('793f4b05-0000-4000-8000-0000000002a9'), '', 'NL2: e não grava dono');

-- ===========================================================================
-- (FL) org B, SEM a flag: tudo como antes da migration
-- ===========================================================================
SELECT throws_ok(
  $q$INSERT INTO public.lead_owners (organization_id, lead_id, team_member_id, role, is_primary, source)
     VALUES ('793f4b05-0000-4000-8000-00000000000b', '793f4b05-0000-4000-8000-0000000002b1',
             '793f4b05-0000-4000-8000-0000000001b2', 'co', false, 'manual')$q$,
  'PT403', NULL, 'FL4: guarda recusa linha de org sem a flag até para o dono do banco');

INSERT INTO public.leads (id, organization_id, name, origin, sale_responsible_id)
VALUES ('793f4b05-0000-4000-8000-0000000002b3', '793f4b05-0000-4000-8000-00000000000b', 'LB3', 'meta_ads', '793f4b05-0000-4000-8000-0000000001b2');
UPDATE public.leads SET sale_responsible_id = '793f4b05-0000-4000-8000-0000000001b2'
 WHERE id = '793f4b05-0000-4000-8000-0000000002b1';
UPDATE public.leads SET responsible_id = '793f4b05-0000-4000-8000-0000000001b1'
 WHERE id = '793f4b05-0000-4000-8000-0000000002b3';
SELECT is((SELECT count(*)::int FROM public.lead_owners WHERE organization_id = '793f4b05-0000-4000-8000-00000000000b'), 0,
  'FL5: INSERT/UPDATE de dono em lead da org sem flag não escreve em lead_owners');
UPDATE public.leads SET sale_responsible_id = '793f4b05-0000-4000-8000-0000000001b1'
 WHERE id = '793f4b05-0000-4000-8000-0000000002b1';

SELECT pg_temp.as_user('793f4b05-0000-4000-8000-0000000000b1');
SET LOCAL role authenticated;
SELECT throws_ok(
  $q$SELECT public.lead_owner_add('793f4b05-0000-4000-8000-0000000002b1', '793f4b05-0000-4000-8000-0000000001b2')$q$,
  'PT403', 'N donos por lead não está ativo nesta organização.', 'FL6: admin da org sem flag: add recusado');
SELECT throws_ok(
  $q$SELECT public.lead_owner_transfer('793f4b05-0000-4000-8000-0000000002b1', '793f4b05-0000-4000-8000-0000000001b2', 'venda')$q$,
  'PT403', NULL, 'FL7: transfer recusado');
SELECT throws_ok(
  $q$SELECT public.lead_owner_remove('793f4b05-0000-4000-8000-0000000002b1', '793f4b05-0000-4000-8000-0000000001b2')$q$,
  'PT403', NULL, 'FL8: remove recusado');
RESET role;
SELECT is(
  (SELECT sale_responsible_id FROM public.leads WHERE id = '793f4b05-0000-4000-8000-0000000002b1'),
  '793f4b05-0000-4000-8000-0000000001b1'::uuid,
  'FL9: o transfer recusado não mudou a coluna');

-- Membro restrito da org B: vê e edita o que é dele, não vê o resto (como hoje).
SELECT pg_temp.as_user('793f4b05-0000-4000-8000-0000000000b2');
SET LOCAL role authenticated;
SELECT is((SELECT array_agg(name ORDER BY name)::text FROM public.leads
            WHERE organization_id = '793f4b05-0000-4000-8000-00000000000b'),
  '{LB2,LB3}', 'FL10: membro da org sem flag vê exatamente os leads pelas colunas');
WITH u AS (UPDATE public.leads SET name = 'LB2 editado' WHERE id = '793f4b05-0000-4000-8000-0000000002b2' RETURNING 1)
SELECT is(count(*)::int, 1, 'FL11: e edita o próprio lead') FROM u;
WITH u AS (UPDATE public.leads SET name = 'LB invadido' WHERE id = '793f4b05-0000-4000-8000-0000000002b1' RETURNING 1)
SELECT is(count(*)::int, 0, 'FL12: e não edita o lead alheio') FROM u;
RESET role;

-- ===========================================================================
-- (INV) invariante sobre os leads do teste
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int
     FROM public.leads l
     CROSS JOIN LATERAL (VALUES ('pre_venda', l.pre_sale_responsible_id), ('venda', l.sale_responsible_id)) r(role, tm)
     JOIN public.team_members m ON m.id = r.tm AND m.organization_id = l.organization_id
    WHERE l.id::text LIKE '793f4b05-%'
      AND public.lead_owners_enabled(l.organization_id)
      AND NOT EXISTS (SELECT 1 FROM public.lead_owners o
                       WHERE o.lead_id = l.id AND o.team_member_id = r.tm
                         AND o.role = r.role AND o.is_primary)),
  0, 'INV1: em org com a flag, toda coluna canônica (mesma org) tem principal em lead_owners');
SELECT is(
  (SELECT count(*)::int FROM public.lead_owners o
    WHERE o.lead_id::text LIKE '793f4b05-%' AND o.role = 'co'
      AND EXISTS (SELECT 1 FROM public.lead_owners p
                   WHERE p.lead_id = o.lead_id AND p.team_member_id = o.team_member_id AND p.is_primary)),
  0, 'INV2: ninguém é co-dono e principal do mesmo lead');

-- ===========================================================================
-- (DR) can_update_lead == policy de UPDATE, já com co-donos
-- ===========================================================================
-- Co-donos para o probe: s1 em L4 e x1 em L2.
SELECT pg_temp.as_user('793f4b05-0000-4000-8000-0000000000a1');
SET LOCAL role authenticated;
SELECT lives_ok(
  $q$SELECT public.lead_owner_add('793f4b05-0000-4000-8000-0000000002a4', '793f4b05-0000-4000-8000-0000000001a3')$q$,
  'DR0a: Envase volta como co-dona de L4');
SELECT lives_ok(
  $q$SELECT public.lead_owner_add('793f4b05-0000-4000-8000-0000000002a2', '793f4b05-0000-4000-8000-0000000001a5')$q$,
  'DR0b: membro sem vínculo vira co-dono de L2');
RESET role;

CREATE FUNCTION pg_temp.probe_policy(p_lead uuid) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM public.leads WHERE id = p_lead FOR KEY SHARE;
  RETURN FOUND;
END $$;

CREATE TEMP TABLE t_drift (persona uuid, lead uuid, pela_policy boolean, pela_funcao boolean);
GRANT INSERT, SELECT ON t_drift TO authenticated;

DO $$
DECLARE
  v_persona uuid;
  v_lead uuid;
  v_policy boolean;
BEGIN
  FOREACH v_persona IN ARRAY ARRAY[
    '793f4b05-0000-4000-8000-0000000000a1', '793f4b05-0000-4000-8000-0000000000a2',
    '793f4b05-0000-4000-8000-0000000000a3', '793f4b05-0000-4000-8000-0000000000a4',
    '793f4b05-0000-4000-8000-0000000000a5', '793f4b05-0000-4000-8000-0000000000b1']::uuid[]
  LOOP
    FOREACH v_lead IN ARRAY ARRAY[
      '793f4b05-0000-4000-8000-0000000002a1', '793f4b05-0000-4000-8000-0000000002a2',
      '793f4b05-0000-4000-8000-0000000002a3', '793f4b05-0000-4000-8000-0000000002a4',
      '793f4b05-0000-4000-8000-0000000002a5', '793f4b05-0000-4000-8000-0000000002b1']::uuid[]
    LOOP
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_persona, 'role', 'authenticated')::text, true);
      SET LOCAL role authenticated;
      v_policy := pg_temp.probe_policy(v_lead);
      RESET role;
      INSERT INTO t_drift VALUES (v_persona, v_lead, v_policy, public.can_update_lead(v_lead));
    END LOOP;
  END LOOP;
END $$;

SELECT is(
  (SELECT count(*)::int FROM t_drift WHERE pela_policy IS DISTINCT FROM pela_funcao),
  0, 'DR1: can_update_lead concorda com a policy de UPDATE em todos os 36 pares');
SELECT ok(
  (SELECT pela_policy AND pela_funcao FROM t_drift
    WHERE persona = '793f4b05-0000-4000-8000-0000000000a5' AND lead = '793f4b05-0000-4000-8000-0000000002a2'),
  'DR2: inclusive no par liberado SÓ por ser co-dono');
SELECT ok(
  (SELECT bool_or(pela_policy) AND bool_or(NOT pela_policy) FROM t_drift),
  'DR3: e o conjunto tem pares liberados E recusados (o teste não é vácuo)');

SELECT * FROM finish();
ROLLBACK;
