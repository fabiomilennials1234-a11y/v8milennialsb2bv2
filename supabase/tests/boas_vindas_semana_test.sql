-- supabase/tests/boas_vindas_semana_test.sql
--
-- Abertura de segunda-feira — 20271226000000_boas_vindas_semana.sql.
--
-- O QUE ESTE ARQUIVO PROVA
--
--   (a) estrutura e grants: a RPC é de `authenticated`; a função interna e o
--       caderno de "já viu" não são de ninguém além do dono.
--   (b) os NÚMEROS, com data fixa (2027-11-01 é uma segunda-feira):
--         · semana ISO anterior cortada no fuso da org — o lead e a venda de
--           domingo 23:30 (-03) caem em DOMINGO, e não na semana seguinte,
--           embora em UTC já seja segunda;
--         · lead sombra, excluído das métricas e apagado NÃO contam;
--         · `metrics_period_at` vence `created_at` (mesmo predicado do painel);
--         · venda estornada sai da receita e da contagem; `sale_lost` nunca é receita;
--         · nada de outra org entra.
--   (c) a reivindicação, que depende do dia em que o teste roda (a regra é "só
--       segunda"): o resultado esperado é calculado no SQL com a mesma conta do
--       fuso, então o arquivo é verde em qualquer dia da semana e o plano tem o
--       mesmo número de asserts nos dois caminhos.
--         · uma vez por USUÁRIO (o 2º usuário da mesma org ainda recebe);
--         · a 2ª chamada do mesmo usuário já não recebe.
--   (d) isolamento: quem não é da org leva access_denied; sem login, 42501.
--
-- Run:
--   supabase start && bash supabase/tests/run.sh
-- or:
--   pg_prove -d "$DATABASE_URL" supabase/tests/boas_vindas_semana_test.sql
--
-- Roda inteiro dentro de transação revertida — não muta o banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(46);

-- ---------------------------------------------------------------------------
-- (a) Estrutura e grants
-- ---------------------------------------------------------------------------
SELECT has_function('public', 'boas_vindas_semana_reivindicar', ARRAY['uuid'],
  '(a) boas_vindas_semana_reivindicar(uuid) existe');

SELECT has_function('public', 'boas_vindas_semana_resumo', ARRAY['uuid', 'date'],
  '(a) boas_vindas_semana_resumo(uuid, date) existe');

SELECT ok(
  has_function_privilege('authenticated', 'public.boas_vindas_semana_reivindicar(uuid)', 'EXECUTE'),
  '(a) authenticated executa a RPC');

SELECT ok(
  NOT has_function_privilege('anon', 'public.boas_vindas_semana_reivindicar(uuid)', 'EXECUTE'),
  '(a) anon NÃO executa a RPC (EXECUTE herdado de PUBLIC foi tirado)');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.boas_vindas_semana_resumo(uuid, date)', 'EXECUTE'),
  '(a) a função interna NÃO é chamável pelo front');

SELECT ok(
  NOT has_function_privilege('anon', 'public.boas_vindas_semana_resumo(uuid, date)', 'EXECUTE'),
  '(a) a função interna NÃO é chamável por anon');

SELECT ok(
  (SELECT c.relrowsecurity FROM pg_class c
   WHERE c.oid = 'public.boas_vindas_semana_vistas'::regclass),
  '(a) o caderno de "já viu" tem RLS ligada');

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.boas_vindas_semana_vistas', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.boas_vindas_semana_vistas', 'INSERT'),
  '(a) o front não lê nem escreve o caderno direto — só pela RPC');

-- ---------------------------------------------------------------------------
-- Fixtures
--   Org A  números com data fixa (semana 2027-10-25 .. 2027-10-31)
--   Org B  outra org, com dado na MESMA semana (prova de isolamento)
--   Org C  vazia
--   Org D  dados relativos a AGORA (prova a reivindicação de ponta a ponta)
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES
  ('b0a5b0a5-aaaa-0000-0000-000000000001', 'BV Org A', 'bv-org-a-aoa', 'America/Sao_Paulo'),
  ('b0a5b0a5-bbbb-0000-0000-000000000001', 'BV Org B', 'bv-org-b-aoa', 'America/Sao_Paulo'),
  ('b0a5b0a5-cccc-0000-0000-000000000001', 'BV Org C', 'bv-org-c-aoa', 'America/Sao_Paulo'),
  ('b0a5b0a5-dddd-0000-0000-000000000001', 'BV Org D', 'bv-org-d-aoa', 'America/Sao_Paulo')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
)
SELECT
  u.id, u.email, '', now(), '{}'::jsonb, now(), now(),
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  '', '', '', '', '', '', '', ''
FROM (VALUES
  ('b0a5b0a5-0001-0000-0000-000000000001'::uuid, 'bv-ua@test.local'),
  ('b0a5b0a5-0002-0000-0000-000000000001'::uuid, 'bv-ub@test.local'),
  ('b0a5b0a5-0003-0000-0000-000000000001'::uuid, 'bv-ud1@test.local'),
  ('b0a5b0a5-0004-0000-0000-000000000001'::uuid, 'bv-ud2@test.local')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('b0a5b0a5-1111-0000-0000-000000000001', 'b0a5b0a5-aaaa-0000-0000-000000000001',
   'b0a5b0a5-0001-0000-0000-000000000001', 'Membro A', 'member', true),
  ('b0a5b0a5-2222-0000-0000-000000000001', 'b0a5b0a5-bbbb-0000-0000-000000000001',
   'b0a5b0a5-0002-0000-0000-000000000001', 'Membro B', 'member', true),
  ('b0a5b0a5-3333-0000-0000-000000000001', 'b0a5b0a5-dddd-0000-0000-000000000001',
   'b0a5b0a5-0003-0000-0000-000000000001', 'Membro D1', 'member', true),
  ('b0a5b0a5-4444-0000-0000-000000000001', 'b0a5b0a5-dddd-0000-0000-000000000001',
   'b0a5b0a5-0004-0000-0000-000000000001', 'Membro D2', 'member', true)
ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active;

-- ── Org A — LEADS (semana 25/10 a 31/10 de 2027; -03 o ano todo) ───────────
--   seg 25   2 leads
--   qua 27   1 lead
--   qui 28   1 lead cujo created_at é de 10/10 mas metrics_period_at é 28/10
--   dom 31   1 lead às 23:30 (-03) = 02:30 UTC de 01/11 → ainda é DOMINGO
--   NÃO contam: sombra, excluído das métricas, apagado
--   semana anterior (18 a 24/10): 2 leads
INSERT INTO public.leads (id, organization_id, name, created_at, metrics_period_at, is_shadow, excluded_from_metrics, deleted_at)
VALUES
  ('b0a5b0a5-aaaa-1000-0000-000000000001', 'b0a5b0a5-aaaa-0000-0000-000000000001', 'L seg 1', '2027-10-25 10:00-03', NULL, false, false, NULL),
  ('b0a5b0a5-aaaa-1000-0000-000000000002', 'b0a5b0a5-aaaa-0000-0000-000000000001', 'L seg 2', '2027-10-25 15:00-03', NULL, false, false, NULL),
  ('b0a5b0a5-aaaa-1000-0000-000000000003', 'b0a5b0a5-aaaa-0000-0000-000000000001', 'L qua',   '2027-10-27 09:00-03', NULL, false, false, NULL),
  ('b0a5b0a5-aaaa-1000-0000-000000000004', 'b0a5b0a5-aaaa-0000-0000-000000000001', 'L qui (período manual)', '2027-10-10 09:00-03', '2027-10-28 11:00-03', false, false, NULL),
  ('b0a5b0a5-aaaa-1000-0000-000000000005', 'b0a5b0a5-aaaa-0000-0000-000000000001', 'L dom 23:30', '2027-10-31 23:30-03', NULL, false, false, NULL),
  ('b0a5b0a5-aaaa-1000-0000-000000000006', 'b0a5b0a5-aaaa-0000-0000-000000000001', 'L sombra',    '2027-10-26 10:00-03', NULL, true,  false, NULL),
  ('b0a5b0a5-aaaa-1000-0000-000000000007', 'b0a5b0a5-aaaa-0000-0000-000000000001', 'L excluído',  '2027-10-26 11:00-03', NULL, false, true,  NULL),
  ('b0a5b0a5-aaaa-1000-0000-000000000008', 'b0a5b0a5-aaaa-0000-0000-000000000001', 'L apagado',   '2027-10-26 12:00-03', NULL, false, false, '2027-10-29 10:00-03'),
  ('b0a5b0a5-aaaa-1000-0000-000000000009', 'b0a5b0a5-aaaa-0000-0000-000000000001', 'L ant 1',     '2027-10-20 10:00-03', NULL, false, false, NULL),
  ('b0a5b0a5-aaaa-1000-0000-000000000010', 'b0a5b0a5-aaaa-0000-0000-000000000001', 'L ant 2',     '2027-10-21 10:00-03', NULL, false, false, NULL),
  -- Org B, mesma semana: não pode vazar para a A.
  ('b0a5b0a5-bbbb-1000-0000-000000000001', 'b0a5b0a5-bbbb-0000-0000-000000000001', 'L B',         '2027-10-26 10:00-03', NULL, false, false, NULL)
ON CONFLICT (id) DO NOTHING;

-- Lead-âncora das vendas (sale_events.lead_id é NOT NULL).
INSERT INTO public.leads (id, organization_id, name)
VALUES
  ('b0a5b0a5-aaaa-2000-0000-000000000001', 'b0a5b0a5-aaaa-0000-0000-000000000001', 'Âncora A'),
  ('b0a5b0a5-bbbb-2000-0000-000000000001', 'b0a5b0a5-bbbb-0000-0000-000000000001', 'Âncora B'),
  ('b0a5b0a5-dddd-2000-0000-000000000001', 'b0a5b0a5-dddd-0000-0000-000000000001', 'Âncora D')
ON CONFLICT (id) DO NOTHING;

-- ── Org A — VENDAS ──────────────────────────────────────────────────────────
--   ter 26   1000
--   qui 28    500                       e 2500, que é ESTORNADA (sai de tudo)
--   dom 31    300 às 23:30 (-03) → domingo
--   qua 27   sale_lost (nunca é receita)
--   semana anterior: 400 em 20/10
INSERT INTO public.sale_events
  (organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
   sale_value, revenue_stream, source)
VALUES
 ('b0a5b0a5-aaaa-0000-0000-000000000001','b0a5b0a5-aaaa-2000-0000-000000000001','b0a5b0a5-aaaa-4444-0000-000000000001','vendido','sale',     '2027-10-26 12:00-03',1000,'novo_negocio','backfill'),
 ('b0a5b0a5-aaaa-0000-0000-000000000001','b0a5b0a5-aaaa-2000-0000-000000000001','b0a5b0a5-aaaa-4444-0000-000000000001','vendido','sale',     '2027-10-28 12:00-03', 500,'carteira',     'backfill'),
 ('b0a5b0a5-aaaa-0000-0000-000000000001','b0a5b0a5-aaaa-2000-0000-000000000001','b0a5b0a5-aaaa-4444-0000-000000000001','vendido','sale',     '2027-10-28 14:00-03',2500,'novo_negocio','backfill'),
 ('b0a5b0a5-aaaa-0000-0000-000000000001','b0a5b0a5-aaaa-2000-0000-000000000001','b0a5b0a5-aaaa-4444-0000-000000000001','vendido','sale',     '2027-10-31 23:30-03', 300,'novo_negocio','backfill'),
 ('b0a5b0a5-aaaa-0000-0000-000000000001','b0a5b0a5-aaaa-2000-0000-000000000001','b0a5b0a5-aaaa-4444-0000-000000000001','perdido','sale_lost','2027-10-27 12:00-03',NULL,'novo_negocio','backfill'),
 ('b0a5b0a5-aaaa-0000-0000-000000000001','b0a5b0a5-aaaa-2000-0000-000000000001','b0a5b0a5-aaaa-4444-0000-000000000001','vendido','sale',     '2027-10-20 12:00-03', 400,'novo_negocio','backfill'),
 -- Org B, mesma semana.
 ('b0a5b0a5-bbbb-0000-0000-000000000001','b0a5b0a5-bbbb-2000-0000-000000000001','b0a5b0a5-bbbb-4444-0000-000000000001','vendido','sale',     '2027-10-26 12:00-03', 999,'novo_negocio','backfill');

-- Estorno da venda de 2500.
INSERT INTO public.sale_events
  (organization_id, lead_id, pipeline_id, stage_key, event_type, reversed_event_id, sold_at,
   sale_value, revenue_stream, source)
SELECT s.organization_id, s.lead_id, s.pipeline_id, 'esfriou', 'sale_reversed', s.id,
       '2027-10-30 12:00-03', s.sale_value, s.revenue_stream, 'backfill'
FROM public.sale_events s
WHERE s.organization_id = 'b0a5b0a5-aaaa-0000-0000-000000000001'
  AND s.event_type = 'sale' AND s.sale_value = 2500;

-- ── Org D — dados RELATIVOS a agora: quarta-feira da semana passada, no fuso da org.
INSERT INTO public.leads (organization_id, name, created_at)
SELECT 'b0a5b0a5-dddd-0000-0000-000000000001', 'L D',
       (((date_trunc('week', (now() AT TIME ZONE 'America/Sao_Paulo'))::date - 5) + time '12:00')
         AT TIME ZONE 'America/Sao_Paulo');

INSERT INTO public.sale_events
  (organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
   sale_value, revenue_stream, source)
SELECT 'b0a5b0a5-dddd-0000-0000-000000000001', 'b0a5b0a5-dddd-2000-0000-000000000001',
       'b0a5b0a5-dddd-4444-0000-000000000001', 'vendido', 'sale',
       (((date_trunc('week', (now() AT TIME ZONE 'America/Sao_Paulo'))::date - 5) + time '12:00')
         AT TIME ZONE 'America/Sao_Paulo'),
       777, 'novo_negocio', 'backfill';

-- ── O que é do Torque (org A, semana 25/10 a 31/10 de 2027) ─────────────────
-- Gente: Membro A (já existe), Ana (ativa), Inativo (desativado), e a Eva da org E.
INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
)
SELECT
  u.id, u.email, '', now(), '{}'::jsonb, now(), now(),
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  '', '', '', '', '', '', '', ''
FROM (VALUES
  ('b0a5b0a5-0005-0000-0000-000000000001'::uuid, 'bv-ana@test.local'),
  ('b0a5b0a5-0006-0000-0000-000000000001'::uuid, 'bv-inativo@test.local'),
  ('b0a5b0a5-0007-0000-0000-000000000001'::uuid, 'bv-eva@test.local')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES ('b0a5b0a5-eeee-0000-0000-000000000001', 'BV Org E', 'bv-org-e-aoa', 'America/Sao_Paulo')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('b0a5b0a5-5555-0000-0000-000000000001', 'b0a5b0a5-aaaa-0000-0000-000000000001', 'b0a5b0a5-0005-0000-0000-000000000001', 'Ana', 'member', true),
  ('b0a5b0a5-6666-0000-0000-000000000001', 'b0a5b0a5-aaaa-0000-0000-000000000001', 'b0a5b0a5-0006-0000-0000-000000000001', 'Inativo', 'member', false),
  ('b0a5b0a5-7777-0000-0000-000000000001', 'b0a5b0a5-eeee-0000-0000-000000000001', 'b0a5b0a5-0007-0000-0000-000000000001', 'Eva', 'member', true)
ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active;

-- MOVIMENTAÇÃO. Quem conta: Ana 3, Membro A 2.
--   NÃO contam: Inativo (5, desativado), automação (4, actor nulo), a CRIAÇÃO de
--   cartão da Ana (from_stage_key nulo — não é movimento) e um movimento da Ana
--   na semana anterior. Org B, mesma semana, tem o dela: não pode vazar.
INSERT INTO public.pipeline_stage_events
  (organization_id, lead_id, pipeline_id, from_stage_key, to_stage_key, occurred_at, actor, source)
SELECT 'b0a5b0a5-aaaa-0000-0000-000000000001', 'b0a5b0a5-aaaa-2000-0000-000000000001',
       'b0a5b0a5-aaaa-4444-0000-000000000001', 'novo', 'contato_' || g,
       '2027-10-26 10:00-03'::timestamptz + (g || ' hours')::interval, a.uid, 'trigger'
FROM (VALUES
  ('b0a5b0a5-0005-0000-0000-000000000001'::uuid, 3),   -- Ana
  ('b0a5b0a5-0001-0000-0000-000000000001'::uuid, 2),   -- Membro A
  ('b0a5b0a5-0006-0000-0000-000000000001'::uuid, 5),   -- Inativo
  (NULL::uuid,                                   4)    -- automação
) AS a(uid, n)
CROSS JOIN LATERAL generate_series(1, a.n) AS g;

INSERT INTO public.pipeline_stage_events
  (organization_id, lead_id, pipeline_id, from_stage_key, to_stage_key, occurred_at, actor, source)
VALUES
  -- criação do cartão: from_stage_key nulo
  ('b0a5b0a5-aaaa-0000-0000-000000000001', 'b0a5b0a5-aaaa-2000-0000-000000000001', 'b0a5b0a5-aaaa-4444-0000-000000000001', NULL,   'novo',    '2027-10-27 09:00-03', 'b0a5b0a5-0005-0000-0000-000000000001', 'trigger'),
  -- semana anterior
  ('b0a5b0a5-aaaa-0000-0000-000000000001', 'b0a5b0a5-aaaa-2000-0000-000000000001', 'b0a5b0a5-aaaa-4444-0000-000000000001', 'novo', 'contato', '2027-10-20 09:00-03', 'b0a5b0a5-0005-0000-0000-000000000001', 'trigger'),
  -- org B, mesma semana
  ('b0a5b0a5-bbbb-0000-0000-000000000001', 'b0a5b0a5-bbbb-2000-0000-000000000001', 'b0a5b0a5-bbbb-4444-0000-000000000001', 'novo', 'contato', '2027-10-26 09:00-03', 'b0a5b0a5-0002-0000-0000-000000000001', 'trigger');

-- AUTOMAÇÕES. 'Boas-vindas' roda 4 vezes e 'Cobrança' 2: total 6, a que mais rodou é
-- a primeira. Semana anterior: 3.
INSERT INTO public.workflows (id, organization_id, name, trigger_type)
VALUES
  ('b0a5b0a5-aaaa-5000-0000-000000000001', 'b0a5b0a5-aaaa-0000-0000-000000000001', 'Boas-vindas', 'lead_created'),
  ('b0a5b0a5-aaaa-5000-0000-000000000002', 'b0a5b0a5-aaaa-0000-0000-000000000001', 'Cobrança',    'lead_created')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workflow_executions (workflow_id, organization_id, started_at, status)
SELECT w.id, 'b0a5b0a5-aaaa-0000-0000-000000000001', e.quando, 'completed'
FROM (VALUES
  ('b0a5b0a5-aaaa-5000-0000-000000000001'::uuid, '2027-10-25 10:00-03'::timestamptz),
  ('b0a5b0a5-aaaa-5000-0000-000000000001'::uuid, '2027-10-26 10:00-03'::timestamptz),
  ('b0a5b0a5-aaaa-5000-0000-000000000001'::uuid, '2027-10-27 10:00-03'::timestamptz),
  ('b0a5b0a5-aaaa-5000-0000-000000000001'::uuid, '2027-10-31 23:30-03'::timestamptz),
  ('b0a5b0a5-aaaa-5000-0000-000000000002'::uuid, '2027-10-28 10:00-03'::timestamptz),
  ('b0a5b0a5-aaaa-5000-0000-000000000002'::uuid, '2027-10-29 10:00-03'::timestamptz),
  -- semana anterior (3) e fora da janela (1 em 01/11, já a semana seguinte)
  ('b0a5b0a5-aaaa-5000-0000-000000000001'::uuid, '2027-10-19 10:00-03'::timestamptz),
  ('b0a5b0a5-aaaa-5000-0000-000000000001'::uuid, '2027-10-20 10:00-03'::timestamptz),
  ('b0a5b0a5-aaaa-5000-0000-000000000002'::uuid, '2027-10-21 10:00-03'::timestamptz),
  ('b0a5b0a5-aaaa-5000-0000-000000000001'::uuid, '2027-11-01 00:30-03'::timestamptz)
) AS e(wid, quando)
JOIN public.workflows w ON w.id = e.wid;

-- RANKING. Novembro de 2027 ainda não vendeu nada para a org A, e 01/11 está nos 7
-- primeiros dias: vale OUTUBRO. Ana 8000 (2 vendas), Membro A 4000 (1).
-- As vendas de 25 a 31/10 da org A não têm vendedor e ficam de fora do ranking.
INSERT INTO public.sale_events
  (organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
   sale_value, revenue_stream, sale_responsible_id, source)
VALUES
 ('b0a5b0a5-aaaa-0000-0000-000000000001','b0a5b0a5-aaaa-2000-0000-000000000001','b0a5b0a5-aaaa-4444-0000-000000000001','vendido','sale','2027-10-10 12:00-03',5000,'novo_negocio','b0a5b0a5-5555-0000-0000-000000000001','backfill'),
 ('b0a5b0a5-aaaa-0000-0000-000000000001','b0a5b0a5-aaaa-2000-0000-000000000001','b0a5b0a5-aaaa-4444-0000-000000000001','vendido','sale','2027-10-12 12:00-03',3000,'novo_negocio','b0a5b0a5-5555-0000-0000-000000000001','backfill'),
 ('b0a5b0a5-aaaa-0000-0000-000000000001','b0a5b0a5-aaaa-2000-0000-000000000001','b0a5b0a5-aaaa-4444-0000-000000000001','vendido','sale','2027-10-15 12:00-03',4000,'novo_negocio','b0a5b0a5-1111-0000-0000-000000000001','backfill');

-- `team_members.metric_type` tem DEFAULT 'meetings', e get_ranking_data só põe no ranking de
-- VENDAS quem é 'sales' (ou nulo). Sem isto as fixtures nascem como "reuniões", o ranking sai
-- zerado e o bloco — corretamente — não aparece (medido: asserções 30 a 37 com have NULL).
UPDATE public.team_members SET metric_type = 'sales'
WHERE id IN ('b0a5b0a5-1111-0000-0000-000000000001',
             'b0a5b0a5-5555-0000-0000-000000000001',
             'b0a5b0a5-7777-0000-0000-000000000001');

-- Org E: 1 lead na semana (para ter o que contar) e uma venda JÁ em novembro — o
-- ranking é o do mês corrente, sem recuo.
INSERT INTO public.leads (id, organization_id, name, created_at)
VALUES ('b0a5b0a5-eeee-1000-0000-000000000001', 'b0a5b0a5-eeee-0000-0000-000000000001', 'L E', '2027-10-27 10:00-03')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.sale_events
  (organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
   sale_value, revenue_stream, sale_responsible_id, source)
VALUES
 ('b0a5b0a5-eeee-0000-0000-000000000001','b0a5b0a5-eeee-1000-0000-000000000001','b0a5b0a5-eeee-4444-0000-000000000001','vendido','sale','2027-11-01 09:00-03',1000,'novo_negocio','b0a5b0a5-7777-0000-0000-000000000001','backfill');

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- (b) Os números — função interna, data fixa (segunda 2027-11-01)
-- ---------------------------------------------------------------------------
SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->>'inicio',
  '2027-10-25', '(b) a semana contada começa na segunda anterior');

SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->>'fim',
  '2027-10-31', '(b) e termina no domingo');

SELECT is(
  ((public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->>'leads')::int,
  5, '(b) leads: sombra, excluído e apagado ficam de fora; período manual vale; domingo 23:30 conta');

SELECT is(
  ((public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->>'vendas')::int,
  3, '(b) vendas: a estornada e o sale_lost ficam de fora');

SELECT is(
  ((public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->>'receita')::numeric,
  1800::numeric, '(b) receita: 1000 + 500 + 300 (a venda de 2500 foi estornada)');

SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'por_dia'->'leads',
  '[2,0,1,1,0,0,1]'::jsonb, '(b) leads por dia, segunda a domingo, no fuso da org');

SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'por_dia'->'vendas',
  '[0,1,0,1,0,0,1]'::jsonb, '(b) vendas por dia — a de domingo 23:30 fica no domingo');

SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'por_dia'->'receita',
  '[0,1000,0,500,0,0,300]'::jsonb, '(b) receita por dia');

SELECT is(
  ((public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'anterior'->>'leads')::int,
  2, '(b) semana anterior à contada: leads');

SELECT is(
  ((public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'anterior'->>'vendas')::int,
  1, '(b) semana anterior à contada: vendas');

SELECT is(
  ((public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'anterior'->>'receita')::numeric,
  400::numeric, '(b) semana anterior à contada: receita');

SELECT is(
  public.boas_vindas_semana_resumo('b0a5b0a5-cccc-0000-0000-000000000001', '2027-11-01'),
  NULL::jsonb, '(b) org sem lead nem venda na semana: NULL — não há o que contar');

SELECT is(
  ((public.boas_vindas_semana_resumo('b0a5b0a5-bbbb-0000-0000-000000000001', '2027-11-01'))->>'leads')::int,
  1, '(b) isolamento: a org B vê só o dela (1 lead), e os 5 da A não entram');

-- ── (e) O que é do Torque ────────────────────────────────────────────────────
SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'automacoes'->>'execucoes',
  '6', '(e) automações: 6 execuções na semana (a de 01/11 00:30 já é da semana seguinte)');

SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'automacoes'->'top'->>'nome',
  'Boas-vindas', '(e) a automação que mais rodou');

SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'automacoes'->'top'->>'execucoes',
  '4', '(e) …e quantas vezes ela rodou');

SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'automacoes'->>'anterior',
  '3', '(e) automações: a semana anterior, para a variação');

SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'movimentacao'->>'total',
  '5', '(e) movimentação: só gente ativa — inativo, automação (actor nulo) e criação de cartão ficam de fora');

SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'movimentacao'->'top'->>'nome',
  'Ana', '(e) quem mais moveu lead: a Ana, e não o inativo que moveu mais');

SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'movimentacao'->'top'->>'movimentos',
  '3', '(e) …com 3 movimentos (o da semana anterior não entra)');

SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-bbbb-0000-0000-000000000001', '2027-11-01'))->'movimentacao'->>'total',
  '1', '(e) isolamento: a movimentação da org B é só dela');

SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'ranking'->>'mes',
  '10', '(e) ranking: novembro ainda sem venda e 01/11 está nos 7 primeiros dias — vale outubro');

SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'ranking'->>'corrente',
  'false', '(e) …e o payload avisa que não é o mês corrente');

SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'ranking'->'top'->0->>'nome',
  'Ana', '(e) 1º do ranking: Ana, 8000 em 2 vendas');

SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'ranking'->'top'->1->>'nome',
  'Membro A', '(e) 2º do ranking: Membro A, 4000 em 1 venda');

SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'ranking'->>'pessoas',
  '2', '(e) o ranking conta quem vende e está ativo: o desativado não entra');

SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'ranking'->'voce',
  'null'::jsonb, '(e) sem login (auth.uid() nulo) não há "você" no ranking');

SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-eeee-0000-0000-000000000001', '2027-11-01'))->'ranking'->>'corrente',
  'true', '(e) org com venda em novembro: ranking do mês corrente, sem recuo');

SELECT is(
  (public.boas_vindas_semana_resumo('b0a5b0a5-eeee-0000-0000-000000000001', '2027-11-01'))->'ranking'->>'mes',
  '11', '(e) …e é novembro');

-- FALHA BRANDA, de verdade: some a tabela de execuções e a abertura continua,
-- sem o bloco de automações. (Renomear dentro da transação; volta logo abaixo.)
ALTER TABLE public.workflow_executions RENAME TO workflow_executions_bv_x;

SELECT is(
  ((public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->>'leads')::int,
  5, '(e) falha branda: sem a tabela de execuções, os números centrais continuam');

SELECT ok(
  (public.boas_vindas_semana_resumo('b0a5b0a5-aaaa-0000-0000-000000000001', '2027-11-01'))->'automacoes' IS NULL,
  '(e) falha branda: só o bloco de automações some');

ALTER TABLE public.workflow_executions_bv_x RENAME TO workflow_executions;

-- ---------------------------------------------------------------------------
-- (d) Isolamento e login
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b0a5b0a5-0002-0000-0000-000000000001","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.boas_vindas_semana_reivindicar('b0a5b0a5-aaaa-0000-0000-000000000001') $$,
  'P0001', 'access_denied',
  '(d) membro da org B NÃO reivindica a abertura da org A');

SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.boas_vindas_semana_reivindicar('b0a5b0a5-dddd-0000-0000-000000000001') $$,
  '42501', 'boas_vindas_semana: login necessário',
  '(d) sem login: 42501');

-- ---------------------------------------------------------------------------
-- (c) A reivindicação — org D, dados relativos a agora.
--     Segunda (no fuso da org): 1ª chamada entrega, 2ª não, e o 2º usuário ainda recebe.
--     Outro dia: nenhuma entrega e nada é marcado. Mesmo plano nos dois caminhos.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"b0a5b0a5-0003-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is(
  (public.boas_vindas_semana_reivindicar('b0a5b0a5-dddd-0000-0000-000000000001'))->>'elegivel',
  CASE WHEN extract(isodow FROM (now() AT TIME ZONE 'America/Sao_Paulo')) = 1 THEN 'true' ELSE 'false' END,
  '(c) 1ª chamada do usuário D1: entrega só se hoje é segunda');

SELECT is(
  (public.boas_vindas_semana_reivindicar('b0a5b0a5-dddd-0000-0000-000000000001'))->>'motivo',
  CASE WHEN extract(isodow FROM (now() AT TIME ZONE 'America/Sao_Paulo')) = 1 THEN 'ja_vista' ELSE 'nao_e_segunda' END,
  '(c) 2ª chamada do mesmo usuário: nunca entrega de novo');

SELECT set_config('request.jwt.claims',
  '{"sub":"b0a5b0a5-0004-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is(
  (public.boas_vindas_semana_reivindicar('b0a5b0a5-dddd-0000-0000-000000000001'))->>'elegivel',
  CASE WHEN extract(isodow FROM (now() AT TIME ZONE 'America/Sao_Paulo')) = 1 THEN 'true' ELSE 'false' END,
  '(c) o 2º usuário da mesma org ainda recebe: é uma vez por USUÁRIO, não por org');

SET LOCAL role postgres;

SELECT is(
  (SELECT count(*)::int FROM public.boas_vindas_semana_vistas
   WHERE organization_id = 'b0a5b0a5-dddd-0000-0000-000000000001'),
  CASE WHEN extract(isodow FROM (now() AT TIME ZONE 'America/Sao_Paulo')) = 1 THEN 2 ELSE 0 END,
  '(c) o caderno tem uma linha por usuário que recebeu — e nenhuma fora da segunda');

SELECT is(
  (SELECT count(*)::int FROM public.boas_vindas_semana_vistas
   WHERE organization_id = 'b0a5b0a5-dddd-0000-0000-000000000001'
     AND semana <> date_trunc('week', (now() AT TIME ZONE 'America/Sao_Paulo'))::date),
  0,
  '(c) a semana gravada é a segunda-feira corrente, no fuso da org');

SELECT * FROM finish();
ROLLBACK;
