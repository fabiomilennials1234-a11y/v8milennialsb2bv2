-- supabase/tests/metric_clientes_sem_atuacao_test.sql
--
-- SCRUM-420 — clientes da carteira sem NENHUM toque há 30 dias.
--
-- O que esta suíte guarda:
--
--   (5F) as CINCO fontes contam. Cada caso desliga todas menos uma e verifica
--        que aquela sozinha tira o cliente da lista. É o ponto do card:
--        `days_since_last_order` cobre só pedido, e por isso não serve sozinha.
--   (JA) trinta dias é a régua: 29 dias ainda não conta.
--   (NU) cliente SEM TOQUE NENHUM conta — é o mais abandonado, não o menos.
--   (NO) mas cliente CADASTRADO ontem não conta: ele não está esquecido há 30
--        dias, ele acabou de chegar.
--   (IN) cliente inativo fica fora: não está esquecido, foi desligado.
--   (GR) as duas funções são internas.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('42000000-0000-4000-8000-00000000000a', 'Org CSA', 'org-csa-a', 'America/Sao_Paulo')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO public.pipelines (id, organization_id, name, slug, type, is_active) VALUES
  ('42009191-0000-4000-8000-00000000000a', '42000000-0000-4000-8000-00000000000a',
   'Funil CSA', 'funil-csa', 'custom', true)
ON CONFLICT (id) DO NOTHING;

-- Oito leads, um por cenário.
INSERT INTO public.leads (id, organization_id, name) VALUES
  ('4200ead1-0000-4000-8000-000000000001', '42000000-0000-4000-8000-00000000000a', 'Só pedido recente'),
  ('4200ead1-0000-4000-8000-000000000002', '42000000-0000-4000-8000-00000000000a', 'Só mensagem recente'),
  ('4200ead1-0000-4000-8000-000000000003', '42000000-0000-4000-8000-00000000000a', 'Só reunião recente'),
  ('4200ead1-0000-4000-8000-000000000004', '42000000-0000-4000-8000-00000000000a', 'Só etapa recente'),
  ('4200ead1-0000-4000-8000-000000000005', '42000000-0000-4000-8000-00000000000a', 'Só negócio recente'),
  ('4200ead1-0000-4000-8000-000000000006', '42000000-0000-4000-8000-00000000000a', 'Abandonado ha 60 dias'),
  ('4200ead1-0000-4000-8000-000000000007', '42000000-0000-4000-8000-00000000000a', 'Toque ha 29 dias'),
  ('4200ead1-0000-4000-8000-000000000008', '42000000-0000-4000-8000-00000000000a', 'Nunca teve toque'),
  ('4200ead1-0000-4000-8000-000000000009', '42000000-0000-4000-8000-00000000000a', 'Cadastrado ontem'),
  ('4200ead1-0000-4000-8000-00000000000a', '42000000-0000-4000-8000-00000000000a', 'Inativo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.upsell_clients
  (id, organization_id, lead_id, name, is_active, last_order_at, created_at) VALUES
  ('4200c11e-0000-4000-8000-000000000001','42000000-0000-4000-8000-00000000000a','4200ead1-0000-4000-8000-000000000001','C1 pedido',   true, now() - interval '5 days',  now() - interval '200 days'),
  ('4200c11e-0000-4000-8000-000000000002','42000000-0000-4000-8000-00000000000a','4200ead1-0000-4000-8000-000000000002','C2 mensagem', true, NULL,                        now() - interval '200 days'),
  ('4200c11e-0000-4000-8000-000000000003','42000000-0000-4000-8000-00000000000a','4200ead1-0000-4000-8000-000000000003','C3 reuniao',  true, NULL,                        now() - interval '200 days'),
  ('4200c11e-0000-4000-8000-000000000004','42000000-0000-4000-8000-00000000000a','4200ead1-0000-4000-8000-000000000004','C4 etapa',    true, NULL,                        now() - interval '200 days'),
  ('4200c11e-0000-4000-8000-000000000005','42000000-0000-4000-8000-00000000000a','4200ead1-0000-4000-8000-000000000005','C5 negocio',  true, NULL,                        now() - interval '200 days'),
  ('4200c11e-0000-4000-8000-000000000006','42000000-0000-4000-8000-00000000000a','4200ead1-0000-4000-8000-000000000006','C6 sumido',   true, now() - interval '60 days', now() - interval '200 days'),
  ('4200c11e-0000-4000-8000-000000000007','42000000-0000-4000-8000-00000000000a','4200ead1-0000-4000-8000-000000000007','C7 29 dias',  true, now() - interval '29 days', now() - interval '200 days'),
  ('4200c11e-0000-4000-8000-000000000008','42000000-0000-4000-8000-00000000000a','4200ead1-0000-4000-8000-000000000008','C8 sem toque',true, NULL,                        now() - interval '200 days'),
  ('4200c11e-0000-4000-8000-000000000009','42000000-0000-4000-8000-00000000000a','4200ead1-0000-4000-8000-000000000009','C9 novo',     true, NULL,                        now() - interval '1 day'),
  ('4200c11e-0000-4000-8000-00000000000a','42000000-0000-4000-8000-00000000000a','4200ead1-0000-4000-8000-00000000000a','C10 inativo', false, NULL,                       now() - interval '200 days')
ON CONFLICT (id) DO NOTHING;

-- C2: mensagem recente
INSERT INTO public.whatsapp_messages
  (id, organization_id, instance_id, message_id, remote_jid, phone_number, direction,
   message_type, content, lead_id, timestamp) VALUES
 (gen_random_uuid(),'42000000-0000-4000-8000-00000000000a',NULL,'t-c2','x@s.w','5511920000002','incoming','text','oi','4200ead1-0000-4000-8000-000000000002', now() - interval '3 days');

-- C3: reunião recente
INSERT INTO public.meeting_events
  (id, organization_id, lead_id, event_type, occurred_at, source) VALUES
 (gen_random_uuid(),'42000000-0000-4000-8000-00000000000a','4200ead1-0000-4000-8000-000000000003','meeting_booked', now() - interval '4 days','pipeline');

-- C4: mudança de etapa recente
INSERT INTO public.pipeline_stage_events
  (id, organization_id, lead_id, pipeline_id, from_stage_key, to_stage_key, occurred_at, source) VALUES
 (gen_random_uuid(),'42000000-0000-4000-8000-00000000000a','4200ead1-0000-4000-8000-000000000004','42009191-0000-4000-8000-00000000000a','novo','proposta', now() - interval '6 days','trigger');

-- C5: negócio criado recentemente
INSERT INTO public.pipeline_entries
  (id, organization_id, pipeline_id, lead_id, stage_key, entered_at) VALUES
 (gen_random_uuid(),'42000000-0000-4000-8000-00000000000a','42009191-0000-4000-8000-00000000000a','4200ead1-0000-4000-8000-000000000005','novo', now() - interval '7 days');

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (5F) cada fonte, sozinha, tira o cliente da lista
-- ===========================================================================
SELECT ok(
  public._metric_ultimo_toque('42000000-0000-4000-8000-00000000000a',
    '4200ead1-0000-4000-8000-000000000001', now() - interval '5 days') > now() - interval '30 days',
  '(5F) pedido conta como toque');

SELECT ok(
  public._metric_ultimo_toque('42000000-0000-4000-8000-00000000000a',
    '4200ead1-0000-4000-8000-000000000002', NULL) > now() - interval '30 days',
  '(5F) mensagem conta como toque — e é ela que days_since_last_order não vê');

SELECT ok(
  public._metric_ultimo_toque('42000000-0000-4000-8000-00000000000a',
    '4200ead1-0000-4000-8000-000000000003', NULL) > now() - interval '30 days',
  '(5F) reunião conta como toque');

SELECT ok(
  public._metric_ultimo_toque('42000000-0000-4000-8000-00000000000a',
    '4200ead1-0000-4000-8000-000000000004', NULL) > now() - interval '30 days',
  '(5F) mudança de etapa conta como toque');

SELECT ok(
  public._metric_ultimo_toque('42000000-0000-4000-8000-00000000000a',
    '4200ead1-0000-4000-8000-000000000005', NULL) > now() - interval '30 days',
  '(5F) criação de negócio conta como toque');

-- ===========================================================================
-- (NU) sem toque nenhum é NULL, não uma data antiga
-- ===========================================================================
SELECT is(
  public._metric_ultimo_toque('42000000-0000-4000-8000-00000000000a',
    '4200ead1-0000-4000-8000-000000000008', NULL),
  NULL::timestamptz,
  '(NU) cliente sem toque nenhum devolve NULL — a distinção é informação');

-- ===========================================================================
-- (JA) + (NO) + (IN): a contagem
-- ===========================================================================
-- Contam: C6 (60 dias) e C8 (nunca).
-- Não contam: C1..C5 (toque recente), C7 (29 dias), C9 (cadastrado ontem),
-- C10 (inativo).
SELECT is(
  (public._metric_leaf_clientes_sem_atuacao(
     '42000000-0000-4000-8000-00000000000a', 'total', '{}'::jsonb) ->> 'value')::numeric,
  2::numeric,
  '(JA/NU/NO/IN) contam C6 e C8 — 29 dias, recém-cadastrado e inativo ficam fora');

-- ===========================================================================
-- Recorte por closer
-- ===========================================================================
SELECT is(
  (SELECT (s->>'value')::numeric
     FROM jsonb_array_elements(
       public._metric_leaf_clientes_sem_atuacao(
         '42000000-0000-4000-8000-00000000000a', 'closer', '{}'::jsonb) -> 'series') s
    WHERE s->>'key' = 'sem_closer'),
  2::numeric, '(closer) os dois estão sem responsável declarado');

-- ===========================================================================
-- Recorte fechado
-- ===========================================================================
SELECT throws_ok(
  $$ SELECT public._metric_leaf_clientes_sem_atuacao(
       '42000000-0000-4000-8000-00000000000a', 'tempo', '{}'::jsonb) $$,
  '22023', NULL,
  '(RE) recorte fora do conjunto levanta 22023');

-- ===========================================================================
-- (GR) internas
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('anon',
    'public._metric_ultimo_toque(uuid, uuid, timestamptz)'::regprocedure, 'EXECUTE'),
  '(GR) anon não executa o último toque');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public._metric_leaf_clientes_sem_atuacao(uuid, text, jsonb)'::regprocedure, 'EXECUTE'),
  '(GR) authenticated não executa a medida');

SELECT ok(
  has_function_privilege('service_role',
    'public._metric_leaf_clientes_sem_atuacao(uuid, text, jsonb)'::regprocedure, 'EXECUTE'),
  '(GR) service_role executa');

SELECT * FROM finish();
ROLLBACK;
