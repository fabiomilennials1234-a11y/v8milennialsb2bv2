-- supabase/tests/funil_desfecho_por_mes_filtrado_test.sql
--
-- A pilha de Ganhos/Perdidos acerta o total com filtro ativo (hotfix Café
-- Jurerê; migration 20271231000000_funil_desfecho_por_mes_filtrado.sql).
--
--   (SF) sem filtro: idêntica a get_funil_desfecho_por_mes.
--   (FI) com filtro: busca (nome e código do ERP), responsável (com co-dono),
--        período — o total é o dos cards que get_pipeline_page devolve.
--   (MS) meses do recorte.
--   (SG) fuso inválido -> 22023; usuário de outra org -> access_denied;
--        INVOKER; anon sem EXECUTE.
--
-- Seed como na Café Jurerê: etapa "Vendido" é open + is_final_positive e o
-- ganho vem de deals.outcome. Persona: admin (vê a org toda pela RLS).
-- Roda inteiro em transação revertida.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(14);

SET LOCAL role postgres;

SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone, feature_flags) VALUES
  ('15ab0001-0000-4000-8000-00000000000a', 'Org DF A', 'org-df-a', 'America/Sao_Paulo', '{"lead_owners_n_donos": true}'::jsonb),
  ('15ab0001-0000-4000-8000-00000000000b', 'Org DF B', 'org-df-b', 'America/Sao_Paulo', '{}'::jsonb)
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
    ('15ab0001-0000-4000-8000-0000000000a1', 'df-admin-a@test.local'),
    ('15ab0001-0000-4000-8000-0000000000a2', 'df-vend2-a@test.local'),
    ('15ab0001-0000-4000-8000-0000000000a3', 'df-vend3-a@test.local'),
    ('15ab0001-0000-4000-8000-0000000000b1', 'df-admin-b@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('15ab0001-0000-4000-8000-0000000001a1', '15ab0001-0000-4000-8000-00000000000a', '15ab0001-0000-4000-8000-0000000000a1', 'Admin DF A', 'admin',  true),
  ('15ab0001-0000-4000-8000-0000000001a2', '15ab0001-0000-4000-8000-00000000000a', '15ab0001-0000-4000-8000-0000000000a2', 'Vend 2',     'member', true),
  ('15ab0001-0000-4000-8000-0000000001a3', '15ab0001-0000-4000-8000-00000000000a', '15ab0001-0000-4000-8000-0000000000a3', 'Vend 3',     'member', true),
  ('15ab0001-0000-4000-8000-0000000001b1', '15ab0001-0000-4000-8000-00000000000b', '15ab0001-0000-4000-8000-0000000000b1', 'Admin DF B', 'admin',  true)
ON CONFLICT (id) DO NOTHING;

-- L1 Alfa (ERP 9101, vend2) · L2 Beta (vend3, co-dona vend2) · L3 Gama (vend3) · L4 Delta (perdido)
INSERT INTO public.leads (id, organization_id, name, erp_code, origin, sale_responsible_id, created_at) VALUES
  ('15ab0001-0000-4000-8000-0000000002a1', '15ab0001-0000-4000-8000-00000000000a', 'Alfa Bar',   '9101', 'meta_ads', '15ab0001-0000-4000-8000-0000000001a2', '2026-08-01'),
  ('15ab0001-0000-4000-8000-0000000002a2', '15ab0001-0000-4000-8000-00000000000a', 'Beta Loja',  '9102', 'meta_ads', '15ab0001-0000-4000-8000-0000000001a3', '2026-08-02'),
  ('15ab0001-0000-4000-8000-0000000002a3', '15ab0001-0000-4000-8000-00000000000a', 'Gama Café',  '9103', 'meta_ads', '15ab0001-0000-4000-8000-0000000001a3', '2026-08-03'),
  ('15ab0001-0000-4000-8000-0000000002a4', '15ab0001-0000-4000-8000-00000000000a', 'Delta Bistrô','9104', 'meta_ads', '15ab0001-0000-4000-8000-0000000001a3', '2026-08-04');

INSERT INTO public.lead_owners (organization_id, lead_id, team_member_id, role, is_primary, source) VALUES
  ('15ab0001-0000-4000-8000-00000000000a', '15ab0001-0000-4000-8000-0000000002a2', '15ab0001-0000-4000-8000-0000000001a2', 'co', false, 'manual');

INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('15ab0001-0000-4000-8000-0000000003a1', '15ab0001-0000-4000-8000-00000000000a', 'Funil DF A', 'funil-df-a', 'custom');

INSERT INTO public.pipeline_stages (pipeline_id, stage_key, name, position, stage_role, is_final_positive, is_final_negative) VALUES
  ('15ab0001-0000-4000-8000-0000000003a1', 'novo',    'Novo',    0, 'open', false, false),
  ('15ab0001-0000-4000-8000-0000000003a1', 'vendido', 'Vendido', 1, 'open', true,  false),
  ('15ab0001-0000-4000-8000-0000000003a1', 'perdido', 'Perdido', 2, 'open', false, true);

INSERT INTO public.deals (id, organization_id, title, source, outcome, value, outcome_at) VALUES
  ('15ab0001-0000-4000-8000-0000000005a1', '15ab0001-0000-4000-8000-00000000000a', 'D1', 'human', 'won',  100, '2026-09-10 15:00-03'),
  ('15ab0001-0000-4000-8000-0000000005a2', '15ab0001-0000-4000-8000-00000000000a', 'D2', 'human', 'won',  200, '2026-10-05 15:00-03'),
  ('15ab0001-0000-4000-8000-0000000005a3', '15ab0001-0000-4000-8000-00000000000a', 'D3', 'human', 'won',  300, '2026-10-20 15:00-03'),
  ('15ab0001-0000-4000-8000-0000000005a4', '15ab0001-0000-4000-8000-00000000000a', 'D4', 'human', 'lost',  50, '2026-10-21 15:00-03');

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, deal_id, stage_key, metadata, created_at) VALUES
  ('15ab0001-0000-4000-8000-0000000004a1', '15ab0001-0000-4000-8000-00000000000a', '15ab0001-0000-4000-8000-0000000003a1', '15ab0001-0000-4000-8000-0000000002a1', '15ab0001-0000-4000-8000-0000000005a1', 'vendido', '{"metrics_period_at":"2026-09-10T18:00:00Z"}', '2026-08-01'),
  ('15ab0001-0000-4000-8000-0000000004a2', '15ab0001-0000-4000-8000-00000000000a', '15ab0001-0000-4000-8000-0000000003a1', '15ab0001-0000-4000-8000-0000000002a2', '15ab0001-0000-4000-8000-0000000005a2', 'vendido', '{"metrics_period_at":"2026-10-05T18:00:00Z"}', '2026-08-02'),
  ('15ab0001-0000-4000-8000-0000000004a3', '15ab0001-0000-4000-8000-00000000000a', '15ab0001-0000-4000-8000-0000000003a1', '15ab0001-0000-4000-8000-0000000002a3', '15ab0001-0000-4000-8000-0000000005a3', 'vendido', '{"metrics_period_at":"2026-10-20T18:00:00Z"}', '2026-08-03'),
  ('15ab0001-0000-4000-8000-0000000004a4', '15ab0001-0000-4000-8000-00000000000a', '15ab0001-0000-4000-8000-0000000003a1', '15ab0001-0000-4000-8000-0000000002a4', '15ab0001-0000-4000-8000-0000000005a4', 'perdido', '{}', '2026-08-04');

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- Como o admin da org A
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"15ab0001-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

-- (SF) sem filtro = a irmã
SELECT set_eq(
  $$SELECT * FROM public.get_funil_desfecho_por_mes_filtrado('15ab0001-0000-4000-8000-0000000003a1', '15ab0001-0000-4000-8000-00000000000a', 'America/Sao_Paulo')$$,
  $$SELECT * FROM public.get_funil_desfecho_por_mes('15ab0001-0000-4000-8000-0000000003a1', '15ab0001-0000-4000-8000-00000000000a', 'America/Sao_Paulo')$$,
  'SF: sem filtro, idêntica a get_funil_desfecho_por_mes');

SELECT is(
  (SELECT (sum(cnt), sum(total)::int)::text FROM public.get_funil_desfecho_por_mes_filtrado('15ab0001-0000-4000-8000-0000000003a1', '15ab0001-0000-4000-8000-00000000000a', 'America/Sao_Paulo') WHERE stage_key = 'vendido' AND outcome = 'won'),
  '(3,600)', 'SF: Vendido = 3 ganhos, R$ 600');

-- (FI) busca por nome
SELECT is(
  (SELECT (sum(cnt), sum(total)::int)::text FROM public.get_funil_desfecho_por_mes_filtrado('15ab0001-0000-4000-8000-0000000003a1', '15ab0001-0000-4000-8000-00000000000a', 'America/Sao_Paulo', p_search => 'Alfa') WHERE stage_key = 'vendido'),
  '(1,100)', 'FI: busca "Alfa" = 1 ganho, R$ 100');

-- (FI) busca por código do ERP (os cards acham; a pilha também)
SELECT is(
  (SELECT (sum(cnt), sum(total)::int)::text FROM public.get_funil_desfecho_por_mes_filtrado('15ab0001-0000-4000-8000-0000000003a1', '15ab0001-0000-4000-8000-00000000000a', 'America/Sao_Paulo', p_search => '9103') WHERE stage_key = 'vendido'),
  '(1,300)', 'FI: busca pelo código do ERP 9103 = 1 ganho, R$ 300');

-- (FI) responsável com co-dono (flag lead_owners_n_donos)
SELECT is(
  (SELECT (sum(cnt), sum(total)::int)::text FROM public.get_funil_desfecho_por_mes_filtrado('15ab0001-0000-4000-8000-0000000003a1', '15ab0001-0000-4000-8000-00000000000a', 'America/Sao_Paulo', p_responsible_id => '15ab0001-0000-4000-8000-0000000001a2') WHERE stage_key = 'vendido'),
  '(2,300)', 'FI: responsável Vend 2 = dono de Alfa + co-dono de Beta = 2 ganhos, R$ 300');

-- (FI) o total é o dos cards: mesma contagem que get_pipeline_page devolve
SELECT is(
  (SELECT sum(cnt)::int FROM public.get_funil_desfecho_por_mes_filtrado('15ab0001-0000-4000-8000-0000000003a1', '15ab0001-0000-4000-8000-00000000000a', 'America/Sao_Paulo', p_responsible_id => '15ab0001-0000-4000-8000-0000000001a2') WHERE stage_key = 'vendido'),
  (SELECT count(*)::int FROM public.get_pipeline_page(p_stage_id => 'vendido', p_org_id => '15ab0001-0000-4000-8000-00000000000a', p_page_size => 1000, p_responsible_id => '15ab0001-0000-4000-8000-0000000001a2', p_pipeline_id => '15ab0001-0000-4000-8000-0000000003a1')),
  'FI: contagem = cards que get_pipeline_page devolve com o mesmo filtro');

-- (FI) período (encerrados pelo metrics_period_at)
SELECT is(
  (SELECT (sum(cnt), sum(total)::int)::text FROM public.get_funil_desfecho_por_mes_filtrado('15ab0001-0000-4000-8000-0000000003a1', '15ab0001-0000-4000-8000-00000000000a', 'America/Sao_Paulo', p_period_after => '2026-10-01T03:00:00Z', p_closed_status_keys => ARRAY['vendido','perdido']) WHERE stage_key = 'vendido'),
  '(2,500)', 'FI: período desde 01/10 = 2 ganhos, R$ 500');

-- (FI) filtro que não casa nada: zero linhas, não "tudo"
SELECT is(
  (SELECT count(*)::int FROM public.get_funil_desfecho_por_mes_filtrado('15ab0001-0000-4000-8000-0000000003a1', '15ab0001-0000-4000-8000-00000000000a', 'America/Sao_Paulo', p_search => 'nao-existe-xyz')),
  0, 'FI: busca sem resultado = nenhuma linha');

-- (MS) meses do recorte por responsável
SELECT set_eq(
  $$SELECT month_key, cnt FROM public.get_funil_desfecho_por_mes_filtrado('15ab0001-0000-4000-8000-0000000003a1', '15ab0001-0000-4000-8000-00000000000a', 'America/Sao_Paulo', p_responsible_id => '15ab0001-0000-4000-8000-0000000001a2') WHERE stage_key = 'vendido'$$,
  $$VALUES ('2026-09'::text, 1::bigint), ('2026-10'::text, 1::bigint)$$,
  'MS: Vend 2 tem setembro 1 e outubro 1');

-- (MS) perdido segue separado
SELECT is(
  (SELECT (outcome, sum(cnt), sum(total)::int)::text FROM public.get_funil_desfecho_por_mes_filtrado('15ab0001-0000-4000-8000-0000000003a1', '15ab0001-0000-4000-8000-00000000000a', 'America/Sao_Paulo') WHERE stage_key = 'perdido' GROUP BY outcome),
  '(lost,1,50)', 'MS: Perdido = 1 perda, R$ 50');

-- (SG) fuso inválido
SELECT throws_ok(
  $$SELECT * FROM public.get_funil_desfecho_por_mes_filtrado('15ab0001-0000-4000-8000-0000000003a1', '15ab0001-0000-4000-8000-00000000000a', 'BRT')$$,
  '22023', NULL, 'SG: abreviação de fuso recusada');

-- (SG) usuário de outra org
SELECT set_config('request.jwt.claims',
  '{"sub":"15ab0001-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT * FROM public.get_funil_desfecho_por_mes_filtrado('15ab0001-0000-4000-8000-0000000003a1', '15ab0001-0000-4000-8000-00000000000a', 'America/Sao_Paulo')$$,
  'P0001', NULL, 'SG: usuário de outra org recusado (access_denied)');

RESET role;
SET LOCAL role postgres;

-- (SG) estrutura
SELECT is(
  (SELECT prosecdef FROM pg_proc WHERE proname = 'get_funil_desfecho_por_mes_filtrado'),
  false, 'SG: SECURITY INVOKER (a RLS do usuário decide, igual à coluna)');

SELECT is(
  has_function_privilege('anon', (SELECT oid FROM pg_proc WHERE proname = 'get_funil_desfecho_por_mes_filtrado'), 'EXECUTE'),
  false, 'SG: anon sem EXECUTE');

SELECT * FROM finish();
ROLLBACK;
