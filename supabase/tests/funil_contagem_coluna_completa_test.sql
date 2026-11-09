-- supabase/tests/funil_contagem_coluna_completa_test.sql
--
-- O número da coluna conta os mesmos negócios que os cards (hotfix Café Jurerê;
-- migration 20280101000000_funil_contagem_coluna_completa.sql).
--
--   (ON)  flag ligada: busca por código do ERP e responsável com co-dono contam
--         igual ao get_pipeline_page; nome e "sem filtro" seguem iguais.
--   (OFF) flag desligada: comportamento antigo, byte a byte.
--   (ND)  flag ligada sem lead_owners_n_donos: co-dono não entra (igual ao page).
--   (SG)  INVOKER; anon sem EXECUTE; authenticated com EXECUTE.
--
-- Persona: admin (vê a org toda pela RLS). Roda inteiro em transação revertida.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(15);

SET LOCAL role postgres;

SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone, feature_flags) VALUES
  ('15ac0001-0000-4000-8000-00000000000a', 'Org CC A', 'org-cc-a', 'America/Sao_Paulo',
   '{"lead_owners_n_donos": true, "funil_contagem_coluna_completa": true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

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
    ('15ac0001-0000-4000-8000-0000000000a1', 'cc-admin-a@test.local'),
    ('15ac0001-0000-4000-8000-0000000000a2', 'cc-vend2-a@test.local'),
    ('15ac0001-0000-4000-8000-0000000000a3', 'cc-vend3-a@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('15ac0001-0000-4000-8000-0000000001a1', '15ac0001-0000-4000-8000-00000000000a', '15ac0001-0000-4000-8000-0000000000a1', 'Admin CC A', 'admin',  true),
  ('15ac0001-0000-4000-8000-0000000001a2', '15ac0001-0000-4000-8000-00000000000a', '15ac0001-0000-4000-8000-0000000000a2', 'Vend 2',     'member', true),
  ('15ac0001-0000-4000-8000-0000000001a3', '15ac0001-0000-4000-8000-00000000000a', '15ac0001-0000-4000-8000-0000000000a3', 'Vend 3',     'member', true)
ON CONFLICT (id) DO NOTHING;

-- L1 Alfa (ERP 9101, vend2) · L2 Beta (vend3, co-dona vend2) · L3 Gama (ERP 9103, vend3) · L4 Delta (perdido)
INSERT INTO public.leads (id, organization_id, name, erp_code, origin, sale_responsible_id, created_at) VALUES
  ('15ac0001-0000-4000-8000-0000000002a1', '15ac0001-0000-4000-8000-00000000000a', 'Alfa Bar',    '9101', 'meta_ads', '15ac0001-0000-4000-8000-0000000001a2', '2026-08-01'),
  ('15ac0001-0000-4000-8000-0000000002a2', '15ac0001-0000-4000-8000-00000000000a', 'Beta Loja',   '9102', 'meta_ads', '15ac0001-0000-4000-8000-0000000001a3', '2026-08-02'),
  ('15ac0001-0000-4000-8000-0000000002a3', '15ac0001-0000-4000-8000-00000000000a', 'Gama Café',   '9103', 'meta_ads', '15ac0001-0000-4000-8000-0000000001a3', '2026-08-03'),
  ('15ac0001-0000-4000-8000-0000000002a4', '15ac0001-0000-4000-8000-00000000000a', 'Delta Bistrô','9104', 'meta_ads', '15ac0001-0000-4000-8000-0000000001a3', '2026-08-04');

INSERT INTO public.lead_owners (organization_id, lead_id, team_member_id, role, is_primary, source) VALUES
  ('15ac0001-0000-4000-8000-00000000000a', '15ac0001-0000-4000-8000-0000000002a2', '15ac0001-0000-4000-8000-0000000001a2', 'co', false, 'manual');

INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('15ac0001-0000-4000-8000-0000000003a1', '15ac0001-0000-4000-8000-00000000000a', 'Funil CC A', 'funil-cc-a', 'custom');

INSERT INTO public.pipeline_stages (pipeline_id, stage_key, name, position, stage_role) VALUES
  ('15ac0001-0000-4000-8000-0000000003a1', 'novo',    'Novo',    0, 'open'),
  ('15ac0001-0000-4000-8000-0000000003a1', 'perdido', 'Perdido', 1, 'open');

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, metadata, created_at) VALUES
  ('15ac0001-0000-4000-8000-0000000004a1', '15ac0001-0000-4000-8000-00000000000a', '15ac0001-0000-4000-8000-0000000003a1', '15ac0001-0000-4000-8000-0000000002a1', 'novo',    '{}', '2026-08-01'),
  ('15ac0001-0000-4000-8000-0000000004a2', '15ac0001-0000-4000-8000-00000000000a', '15ac0001-0000-4000-8000-0000000003a1', '15ac0001-0000-4000-8000-0000000002a2', 'novo',    '{}', '2026-08-02'),
  ('15ac0001-0000-4000-8000-0000000004a3', '15ac0001-0000-4000-8000-00000000000a', '15ac0001-0000-4000-8000-0000000003a1', '15ac0001-0000-4000-8000-0000000002a3', 'novo',    '{}', '2026-08-03'),
  ('15ac0001-0000-4000-8000-0000000004a4', '15ac0001-0000-4000-8000-00000000000a', '15ac0001-0000-4000-8000-0000000003a1', '15ac0001-0000-4000-8000-0000000002a4', 'perdido', '{}', '2026-08-04');

SET LOCAL session_replication_role = origin;

-- Atalhos: contagem da coluna "novo" e cards de "novo" com o mesmo filtro.
CREATE FUNCTION pg_temp.cnt_novo(p_search text DEFAULT NULL, p_resp uuid DEFAULT NULL)
RETURNS int LANGUAGE sql AS $$
  SELECT COALESCE((SELECT cnt::int FROM public.get_pipeline_stage_counts_by_id(
    '15ac0001-0000-4000-8000-0000000003a1', '15ac0001-0000-4000-8000-00000000000a',
    p_search => p_search, p_responsible_id => p_resp) WHERE stage_key = 'novo'), 0)
$$;
CREATE FUNCTION pg_temp.cards_novo(p_search text DEFAULT NULL, p_resp uuid DEFAULT NULL)
RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.get_pipeline_page(
    p_stage_id => 'novo', p_org_id => '15ac0001-0000-4000-8000-00000000000a', p_page_size => 1000,
    p_search => p_search, p_responsible_id => p_resp,
    p_pipeline_id => '15ac0001-0000-4000-8000-0000000003a1')
$$;
GRANT EXECUTE ON FUNCTION pg_temp.cnt_novo(text, uuid), pg_temp.cards_novo(text, uuid) TO authenticated;

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"15ac0001-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

-- ===========================================================================
-- (ON) flag ligada
-- ===========================================================================
SELECT set_eq(
  $$SELECT stage_key, cnt FROM public.get_pipeline_stage_counts_by_id('15ac0001-0000-4000-8000-0000000003a1', '15ac0001-0000-4000-8000-00000000000a')$$,
  $$VALUES ('novo'::text, 3::bigint), ('perdido'::text, 1::bigint)$$,
  'ON: sem filtro, novo 3 e perdido 1 (inalterado)');

SELECT is(pg_temp.cnt_novo('9103'), 1, 'ON: busca pelo código do ERP 9103 conta 1');
SELECT is(pg_temp.cnt_novo('9103'), pg_temp.cards_novo('9103'), 'ON: busca por ERP, contagem = cards');
SELECT is(pg_temp.cnt_novo('Alfa'), 1, 'ON: busca por nome segue contando 1');
SELECT is(pg_temp.cnt_novo(p_resp => '15ac0001-0000-4000-8000-0000000001a2'), 2,
  'ON: responsável Vend 2 = dono de Alfa + co-dono de Beta = 2');
SELECT is(pg_temp.cnt_novo(p_resp => '15ac0001-0000-4000-8000-0000000001a2'),
          pg_temp.cards_novo(p_resp => '15ac0001-0000-4000-8000-0000000001a2'),
  'ON: responsável com co-dono, contagem = cards');
SELECT is(pg_temp.cnt_novo(p_resp => '15ac0001-0000-4000-8000-0000000001a3'), 2,
  'ON: responsável Vend 3 = Beta + Gama (co-dono não tira o principal)');
SELECT is(pg_temp.cnt_novo('nao-existe-xyz'), 0, 'ON: busca sem resultado conta 0');

-- ===========================================================================
-- (OFF) flag desligada: comportamento antigo
-- ===========================================================================
RESET role;
SET LOCAL role postgres;
UPDATE public.organizations SET feature_flags = feature_flags - 'funil_contagem_coluna_completa'
 WHERE id = '15ac0001-0000-4000-8000-00000000000a';
SET LOCAL role authenticated;

SELECT is(pg_temp.cnt_novo('9103'), 0, 'OFF: busca por ERP não conta (como antes)');
SELECT is(pg_temp.cnt_novo(p_resp => '15ac0001-0000-4000-8000-0000000001a2'), 1,
  'OFF: responsável Vend 2 ignora co-dono (como antes)');

-- ===========================================================================
-- (ND) flag ligada, mas a org não usa lead_owners_n_donos
-- ===========================================================================
RESET role;
SET LOCAL role postgres;
UPDATE public.organizations SET feature_flags = '{"funil_contagem_coluna_completa": true}'::jsonb
 WHERE id = '15ac0001-0000-4000-8000-00000000000a';
SET LOCAL role authenticated;

SELECT is(pg_temp.cnt_novo(p_resp => '15ac0001-0000-4000-8000-0000000001a2'), 1,
  'ND: sem lead_owners_n_donos, co-dono não entra');
SELECT is(pg_temp.cnt_novo(p_resp => '15ac0001-0000-4000-8000-0000000001a2'),
          pg_temp.cards_novo(p_resp => '15ac0001-0000-4000-8000-0000000001a2'),
  'ND: contagem = cards também sem lead_owners_n_donos');

-- ===========================================================================
-- (SG) estrutura
-- ===========================================================================
RESET role;
SET LOCAL role postgres;

SELECT is(
  (SELECT prosecdef FROM pg_proc WHERE proname = 'get_pipeline_stage_counts_by_id'),
  false, 'SG: SECURITY INVOKER (a RLS do usuário decide)');
SELECT is(
  has_function_privilege('anon', (SELECT oid FROM pg_proc WHERE proname = 'get_pipeline_stage_counts_by_id'), 'EXECUTE'),
  false, 'SG: anon sem EXECUTE');
SELECT is(
  has_function_privilege('authenticated', (SELECT oid FROM pg_proc WHERE proname = 'get_pipeline_stage_counts_by_id'), 'EXECUTE'),
  true, 'SG: authenticated com EXECUTE');

SELECT * FROM finish();
ROLLBACK;
