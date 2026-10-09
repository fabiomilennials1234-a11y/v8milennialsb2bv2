-- supabase/tests/lead_owners_filtro_test.sql
--
-- Chamado 793f4b05 · PR2/5: o filtro "responsável" do funil casa QUALQUER
-- dono do lead (migration 20271116000020_lead_owners_filtro_qualquer_dono.sql).
--
--   (FQ) org COM a flag lead_owners_n_donos: co-dono casa em
--        get_pipeline_page, get_pipeline_lead_ids e get_filtered_lead_ids;
--        principal continua casando; quem não é dono não casa; sem filtro, o
--        board é o mesmo.
--   (FG) gate: org SEM a flag ignora linha 'co' (mesmo plantada por fora da
--        guarda) e a org com a flag desligada volta ao filtro antigo.
--   (FS) estrutura: os dois resolvers seguem SECURITY INVOKER, com
--        search_path pinado, e get_pipeline_page mantém force_generic_plan.
--
-- Persona: admin de cada org (vê todos os leads da org pela RLS). A RLS não
-- é o assunto aqui — é o PREDICADO de responsável.
--
-- Roda inteiro em transação revertida.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

-- ===========================================================================
-- Fixtures (gatilhos desligados: as linhas de lead_owners são plantadas à mão)
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('793f4b05-0000-4000-8000-0000000f000a', 'Org FQ A', 'org-fq-a', 'America/Sao_Paulo'),
  ('793f4b05-0000-4000-8000-0000000f000b', 'Org FQ B', 'org-fq-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

UPDATE public.organizations
   SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"lead_owners_n_donos": true}'::jsonb
 WHERE id = '793f4b05-0000-4000-8000-0000000f000a';
UPDATE public.organizations
   SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) - 'lead_owners_n_donos'
 WHERE id = '793f4b05-0000-4000-8000-0000000f000b';

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
    ('793f4b05-0000-4000-8000-0000000f00a1', 'fq-admin-a@test.local'),
    ('793f4b05-0000-4000-8000-0000000f00a2', 'fq-varejo-a@test.local'),
    ('793f4b05-0000-4000-8000-0000000f00a3', 'fq-envase-a@test.local'),
    ('793f4b05-0000-4000-8000-0000000f00a4', 'fq-alheio-a@test.local'),
    ('793f4b05-0000-4000-8000-0000000f00b1', 'fq-admin-b@test.local'),
    ('793f4b05-0000-4000-8000-0000000f00b2', 'fq-varejo-b@test.local'),
    ('793f4b05-0000-4000-8000-0000000f00b3', 'fq-envase-b@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

-- a1 admin · a2 Varejo · a3 Envase · a4 sem vínculo · b* espelho na org B
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('793f4b05-0000-4000-8000-0000000f01a1', '793f4b05-0000-4000-8000-0000000f000a', '793f4b05-0000-4000-8000-0000000f00a1', 'Admin FQ A',  'admin',  true),
  ('793f4b05-0000-4000-8000-0000000f01a2', '793f4b05-0000-4000-8000-0000000f000a', '793f4b05-0000-4000-8000-0000000f00a2', 'Varejo FQ A', 'member', true),
  ('793f4b05-0000-4000-8000-0000000f01a3', '793f4b05-0000-4000-8000-0000000f000a', '793f4b05-0000-4000-8000-0000000f00a3', 'Envase FQ A', 'member', true),
  ('793f4b05-0000-4000-8000-0000000f01a4', '793f4b05-0000-4000-8000-0000000f000a', '793f4b05-0000-4000-8000-0000000f00a4', 'Alheio FQ A', 'member', true),
  ('793f4b05-0000-4000-8000-0000000f01b1', '793f4b05-0000-4000-8000-0000000f000b', '793f4b05-0000-4000-8000-0000000f00b1', 'Admin FQ B',  'admin',  true),
  ('793f4b05-0000-4000-8000-0000000f01b2', '793f4b05-0000-4000-8000-0000000f000b', '793f4b05-0000-4000-8000-0000000f00b2', 'Varejo FQ B', 'member', true),
  ('793f4b05-0000-4000-8000-0000000f01b3', '793f4b05-0000-4000-8000-0000000f000b', '793f4b05-0000-4000-8000-0000000f00b3', 'Envase FQ B', 'member', true)
ON CONFLICT (id) DO NOTHING;

-- Org A: LA1 venda a2 · LA2 venda a3 + co-dona a2 (transferida) · LA3 sem dono
-- Org B: LB1 venda b3 + linha 'co' de b2 plantada por fora da guarda (gate)
INSERT INTO public.leads (id, organization_id, name, origin, sale_responsible_id, closer_id, created_at) VALUES
  ('793f4b05-0000-4000-8000-0000000f02a1', '793f4b05-0000-4000-8000-0000000f000a', 'LA1', 'meta_ads', '793f4b05-0000-4000-8000-0000000f01a2', '793f4b05-0000-4000-8000-0000000f01a2', now() - interval '3 minutes'),
  ('793f4b05-0000-4000-8000-0000000f02a2', '793f4b05-0000-4000-8000-0000000f000a', 'LA2', 'meta_ads', '793f4b05-0000-4000-8000-0000000f01a3', '793f4b05-0000-4000-8000-0000000f01a3', now() - interval '2 minutes'),
  ('793f4b05-0000-4000-8000-0000000f02a3', '793f4b05-0000-4000-8000-0000000f000a', 'LA3', 'meta_ads', NULL, NULL, now() - interval '1 minute'),
  ('793f4b05-0000-4000-8000-0000000f02b1', '793f4b05-0000-4000-8000-0000000f000b', 'LB1', 'meta_ads', '793f4b05-0000-4000-8000-0000000f01b3', '793f4b05-0000-4000-8000-0000000f01b3', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lead_owners (organization_id, lead_id, team_member_id, role, is_primary, source) VALUES
  ('793f4b05-0000-4000-8000-0000000f000a', '793f4b05-0000-4000-8000-0000000f02a1', '793f4b05-0000-4000-8000-0000000f01a2', 'venda', true,  'backfill'),
  ('793f4b05-0000-4000-8000-0000000f000a', '793f4b05-0000-4000-8000-0000000f02a2', '793f4b05-0000-4000-8000-0000000f01a3', 'venda', true,  'transfer'),
  ('793f4b05-0000-4000-8000-0000000f000a', '793f4b05-0000-4000-8000-0000000f02a2', '793f4b05-0000-4000-8000-0000000f01a2', 'co',    false, 'transfer'),
  ('793f4b05-0000-4000-8000-0000000f000b', '793f4b05-0000-4000-8000-0000000f02b1', '793f4b05-0000-4000-8000-0000000f01b2', 'co',    false, 'manual');

INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('793f4b05-0000-4000-8000-0000000f03a1', '793f4b05-0000-4000-8000-0000000f000a', 'Funil FQ A', 'funil-fq-a', 'custom'),
  ('793f4b05-0000-4000-8000-0000000f03b1', '793f4b05-0000-4000-8000-0000000f000b', 'Funil FQ B', 'funil-fq-b', 'custom')
ON CONFLICT (id) DO NOTHING;

-- Metadata vazio: o filtro antigo também olha a projeção da entry, e aqui
-- só as colunas do lead e lead_owners decidem.
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, metadata, created_at) VALUES
  ('793f4b05-0000-4000-8000-0000000f04a1', '793f4b05-0000-4000-8000-0000000f000a', '793f4b05-0000-4000-8000-0000000f03a1', '793f4b05-0000-4000-8000-0000000f02a1', 'novo', '{}'::jsonb, now() - interval '3 minutes'),
  ('793f4b05-0000-4000-8000-0000000f04a2', '793f4b05-0000-4000-8000-0000000f000a', '793f4b05-0000-4000-8000-0000000f03a1', '793f4b05-0000-4000-8000-0000000f02a2', 'novo', '{}'::jsonb, now() - interval '2 minutes'),
  ('793f4b05-0000-4000-8000-0000000f04a3', '793f4b05-0000-4000-8000-0000000f000a', '793f4b05-0000-4000-8000-0000000f03a1', '793f4b05-0000-4000-8000-0000000f02a3', 'novo', '{}'::jsonb, now() - interval '1 minute'),
  ('793f4b05-0000-4000-8000-0000000f04b1', '793f4b05-0000-4000-8000-0000000f000b', '793f4b05-0000-4000-8000-0000000f03b1', '793f4b05-0000-4000-8000-0000000f02b1', 'novo', '{}'::jsonb, now())
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

-- Nomes dos leads do card, em ordem, para um membro no filtro (NULL = sem filtro).
CREATE FUNCTION pg_temp.board(p_org uuid, p_pipe uuid, p_member uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(g.lead ->> 'name', ',' ORDER BY g.lead ->> 'name'), '')
    FROM public.get_pipeline_page(
           p_stage_id       => 'novo',
           p_org_id         => p_org,
           p_responsible_id => p_member,
           p_page_size      => 50,
           p_pipeline_id    => p_pipe) g
$$;

CREATE FUNCTION pg_temp.ids(p_org uuid, p_pipe uuid, p_member uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(right(x::text, 3), ',' ORDER BY x::text), '')
    FROM public.get_pipeline_lead_ids(
           p_pipeline_id     => p_pipe,
           p_responsible_id  => p_member,
           p_organization_id => p_org) AS x
$$;

CREATE FUNCTION pg_temp.ids_slug(p_org uuid, p_slug text, p_member uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(right(x::text, 3), ',' ORDER BY x::text), '')
    FROM public.get_filtered_lead_ids(
           p_pipeline_type   => p_slug,
           p_responsible_id  => p_member,
           p_organization_id => p_org) AS x
$$;

GRANT EXECUTE ON FUNCTION pg_temp.as_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.board(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.ids(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.ids_slug(uuid, text, uuid) TO authenticated;

-- ===========================================================================
-- (FS) estrutura
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('get_pipeline_page', 'get_pipeline_lead_ids')
      AND NOT p.prosecdef
      AND 'search_path=""' = ANY (p.proconfig)),
  2, 'FS1: get_pipeline_page e get_pipeline_lead_ids seguem INVOKER com search_path vazio');
SELECT ok(
  (SELECT 'plan_cache_mode=force_generic_plan' = ANY (p.proconfig)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_pipeline_page'),
  'FS2: get_pipeline_page mantém force_generic_plan (20271107110000)');
SELECT ok(
  has_function_privilege('authenticated',
    'public.get_pipeline_lead_ids(uuid,text,uuid,text,text,uuid,uuid[],text[],text[],text[],uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated',
    'public.get_pipeline_page(text,text,uuid,integer,timestamptz,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer,uuid)', 'EXECUTE'),
  'FS3: CREATE OR REPLACE preservou o EXECUTE de authenticated nos dois resolvers');

-- ===========================================================================
-- (FQ) org A, com a flag — admin A
-- ===========================================================================
SELECT pg_temp.as_user('793f4b05-0000-4000-8000-0000000f00a1');
SET LOCAL role authenticated;

SELECT is(pg_temp.board('793f4b05-0000-4000-8000-0000000f000a', '793f4b05-0000-4000-8000-0000000f03a1', NULL),
  'LA1,LA2,LA3', 'FQ1: sem filtro, o board é o de sempre');
SELECT is(pg_temp.board('793f4b05-0000-4000-8000-0000000f000a', '793f4b05-0000-4000-8000-0000000f03a1', '793f4b05-0000-4000-8000-0000000f01a2'),
  'LA1,LA2', 'FQ2: get_pipeline_page — Varejo casa o lead dela (principal) E o transferido (co-dona)');
SELECT is(pg_temp.board('793f4b05-0000-4000-8000-0000000f000a', '793f4b05-0000-4000-8000-0000000f03a1', '793f4b05-0000-4000-8000-0000000f01a3'),
  'LA2', 'FQ3: get_pipeline_page — Envase casa só o lead em que é principal');
SELECT is(pg_temp.board('793f4b05-0000-4000-8000-0000000f000a', '793f4b05-0000-4000-8000-0000000f03a1', '793f4b05-0000-4000-8000-0000000f01a4'),
  '', 'FQ4: get_pipeline_page — membro sem vínculo não casa nada (lead sem dono não vaza)');

SELECT is(pg_temp.ids('793f4b05-0000-4000-8000-0000000f000a', '793f4b05-0000-4000-8000-0000000f03a1', '793f4b05-0000-4000-8000-0000000f01a2'),
  '2a1,2a2', 'FQ5: get_pipeline_lead_ids — co-dona entra no recorte');
SELECT is(pg_temp.ids('793f4b05-0000-4000-8000-0000000f000a', '793f4b05-0000-4000-8000-0000000f03a1', '793f4b05-0000-4000-8000-0000000f01a4'),
  '', 'FQ6: get_pipeline_lead_ids — sem vínculo, recorte vazio');
SELECT is(pg_temp.ids('793f4b05-0000-4000-8000-0000000f000a', '793f4b05-0000-4000-8000-0000000f03a1', NULL),
  '2a1,2a2,2a3', 'FQ7: get_pipeline_lead_ids — sem filtro, o funil todo');
SELECT is(pg_temp.ids_slug('793f4b05-0000-4000-8000-0000000f000a', 'funil-fq-a', '793f4b05-0000-4000-8000-0000000f01a2'),
  '2a1,2a2', 'FQ8: get_filtered_lead_ids (wrapper) herda o co-dono');

RESET role;

-- ===========================================================================
-- (FG) gate por org
-- ===========================================================================
SELECT pg_temp.as_user('793f4b05-0000-4000-8000-0000000f00b1');
SET LOCAL role authenticated;

SELECT is(pg_temp.board('793f4b05-0000-4000-8000-0000000f000b', '793f4b05-0000-4000-8000-0000000f03b1', '793f4b05-0000-4000-8000-0000000f01b2'),
  '', 'FG1: org SEM a flag — linha co plantada é ignorada por get_pipeline_page');
SELECT is(pg_temp.ids('793f4b05-0000-4000-8000-0000000f000b', '793f4b05-0000-4000-8000-0000000f03b1', '793f4b05-0000-4000-8000-0000000f01b2'),
  '', 'FG2: org SEM a flag — e por get_pipeline_lead_ids');
SELECT is(pg_temp.board('793f4b05-0000-4000-8000-0000000f000b', '793f4b05-0000-4000-8000-0000000f03b1', '793f4b05-0000-4000-8000-0000000f01b3'),
  'LB1', 'FG3: org SEM a flag — o principal casa como sempre');

RESET role;

UPDATE public.organizations
   SET feature_flags = feature_flags - 'lead_owners_n_donos'
 WHERE id = '793f4b05-0000-4000-8000-0000000f000a';

SELECT pg_temp.as_user('793f4b05-0000-4000-8000-0000000f00a1');
SET LOCAL role authenticated;

SELECT is(pg_temp.board('793f4b05-0000-4000-8000-0000000f000a', '793f4b05-0000-4000-8000-0000000f03a1', '793f4b05-0000-4000-8000-0000000f01a2'),
  'LA1', 'FG4: flag desligada — get_pipeline_page volta ao filtro antigo (só o principal)');
SELECT is(pg_temp.ids('793f4b05-0000-4000-8000-0000000f000a', '793f4b05-0000-4000-8000-0000000f03a1', '793f4b05-0000-4000-8000-0000000f01a2'),
  '2a1', 'FG5: flag desligada — get_pipeline_lead_ids idem');

RESET role;

SELECT * FROM finish();
ROLLBACK;
