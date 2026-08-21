-- supabase/tests/metric_coorte_canonica_test.sql
--
-- SCRUM-368: existe UMA coorte de lead no motor, e ela é escrita num lugar só.
--
-- O que esta suíte guarda (decisão do CTO, 2026-08-21):
--
--   (CA) a coorte canônica é `vivo AND NOT sombra AND NOT excluído`. As três
--        exclusões são provadas separadamente, cada uma com o seu lead.
--   (FL) a exclusão por `excluded_from_metrics` é POR ORGANIZAÇÃO: o mesmo
--        formato de lead conta na org sem a flag. Sem este caso, um predicado
--        que ignorasse a flag e excluísse todo mundo passaria despercebido.
--   (ID) `leads_avaliados + leads_nao_avaliados = leads_criados`. É a identidade
--        que o Estúdio promete, e a razão de a coorte ser única.
--   (SD) `leads_sem_responsavel` usa a MESMA coorte — ele já excluía sombra por
--        conta própria, e agora deixou de decidir sozinho.
--   (UM) NENHUM dos três leaves escreve o predicado à mão. É a asserção que
--        impede a próxima edição de reintroduzir a divergência: onze cópias
--        eram onze chances de discordar.
--   (GR) a função da coorte é INTERNA — anon e authenticated não a executam.
--
-- Roda inteiro em transação revertida — não muta o banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

-- ===========================================================================
-- Fixtures
-- ===========================================================================
--
-- Org C tem a flag LIGADA; org D não tem. É o par que separa "lead só em funil
-- custom" de "org que pediu para não contar lead só de funil custom".
INSERT INTO public.organizations (id, name, slug, timezone, feature_flags) VALUES
  ('36800000-0000-4000-8000-00000000000c', 'Org Coorte C', 'org-coorte-c', 'America/Sao_Paulo',
   '{"exclude_custom_pipe_leads_from_metrics": true}'::jsonb),
  ('36800000-0000-4000-8000-00000000000d', 'Org Coorte D', 'org-coorte-d', 'America/Sao_Paulo',
   '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug, type, is_active) VALUES
  ('36809191-0000-4000-8000-00000000000c', '36800000-0000-4000-8000-00000000000c',
   'Prospecção C', 'prospeccao-c', 'custom', true),
  ('36809191-0000-4000-8000-00000000000d', '36800000-0000-4000-8000-00000000000d',
   'Prospecção D', 'prospeccao-d', 'custom', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.custom_pipeline_stages
  (id, organization_id, pipeline_id, stage_key, name, position, is_active, stage_role) VALUES
  ('36805747-0000-4000-8000-00000000000c', '36800000-0000-4000-8000-00000000000c',
   '36809191-0000-4000-8000-00000000000c', 'prospect', 'Prospect', 1, true, 'open'),
  ('36805747-0000-4000-8000-00000000000d', '36800000-0000-4000-8000-00000000000d',
   '36809191-0000-4000-8000-00000000000d', 'prospect', 'Prospect', 1, true, 'open')
ON CONFLICT (id) DO NOTHING;

-- O CADERNO da org C. Todos na mesma janela; o que muda é só o motivo de sair.
--
--   C1  vivo, sem marca, avaliado          CONTA · avaliado
--   C2  vivo, sem marca, sem avaliação     CONTA · não avaliado
--   C3  is_shadow                          FORA — invisível nos pipes
--   C4  deleted_at preenchido              FORA — apagado
--   C5  só em funil custom, org com flag   FORA — marcado como fora das métricas
--
--   leads_criados = 2 · avaliados = 1 · nao_avaliados = 1
INSERT INTO public.leads
  (id, organization_id, name, origin, created_at, metrics_period_at,
   qualification_tier, is_shadow, deleted_at) VALUES
  ('3680ead1-0000-4000-8000-0000000000c1', '36800000-0000-4000-8000-00000000000c',
   'C1 conta e é avaliado', 'meta_ads', '2027-08-10T12:00:00Z', '2027-08-10T12:00:00Z',
   'A', false, NULL),
  ('3680ead1-0000-4000-8000-0000000000c2', '36800000-0000-4000-8000-00000000000c',
   'C2 conta e não é avaliado', 'meta_ads', '2027-08-11T12:00:00Z', '2027-08-11T12:00:00Z',
   NULL, false, NULL),
  ('3680ead1-0000-4000-8000-0000000000c3', '36800000-0000-4000-8000-00000000000c',
   'C3 sombra do copilot', 'copilot', '2027-08-12T12:00:00Z', '2027-08-12T12:00:00Z',
   NULL, true, NULL),
  ('3680ead1-0000-4000-8000-0000000000c4', '36800000-0000-4000-8000-00000000000c',
   'C4 apagado', 'meta_ads', '2027-08-13T12:00:00Z', '2027-08-13T12:00:00Z',
   NULL, false, '2027-08-14T12:00:00Z'),
  ('3680ead1-0000-4000-8000-0000000000c5', '36800000-0000-4000-8000-00000000000c',
   'C5 só prospecção', 'lista_fria', '2027-08-14T12:00:00Z', '2027-08-14T12:00:00Z',
   NULL, false, NULL),
  -- Org D: MESMO formato do C5, org SEM a flag. Tem que contar.
  ('3680ead1-0000-4000-8000-0000000000d1', '36800000-0000-4000-8000-00000000000d',
   'D1 só prospecção, org sem flag', 'lista_fria', '2027-08-14T12:00:00Z', '2027-08-14T12:00:00Z',
   NULL, false, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.custom_pipe_entries
  (id, organization_id, pipeline_id, lead_id, stage_id, entered_at) VALUES
  ('3680c17e-0000-4000-8000-0000000000c5', '36800000-0000-4000-8000-00000000000c',
   '36809191-0000-4000-8000-00000000000c', '3680ead1-0000-4000-8000-0000000000c5',
   '36805747-0000-4000-8000-00000000000c', '2027-08-14T12:00:00Z'),
  ('3680c17e-0000-4000-8000-0000000000d1', '36800000-0000-4000-8000-00000000000d',
   '36809191-0000-4000-8000-00000000000d', '3680ead1-0000-4000-8000-0000000000d1',
   '36805747-0000-4000-8000-00000000000d', '2027-08-14T12:00:00Z')
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (CA) a coorte exclui sombra, apagado e marcado
-- ===========================================================================
SELECT is(
  (public._metric_leaf_leads_criados(
     '36800000-0000-4000-8000-00000000000c',
     'total',
     tstzrange('2027-08-01T00:00:00Z', '2027-09-01T00:00:00Z', '[)'),
     'America/Sao_Paulo',
     '{}'::jsonb) ->> 'value')::numeric,
  2::numeric,
  '(CA) leads_criados conta 2 de 5 — sombra, apagado e marcado ficam fora');

SELECT ok(
  NOT public._metric_lead_na_coorte(
    NULL, true, '3680ead1-0000-4000-8000-0000000000c3',
    '36800000-0000-4000-8000-00000000000c'),
  '(CA) sombra sozinha já tira o lead da coorte');

SELECT ok(
  NOT public._metric_lead_na_coorte(
    '2027-08-14T12:00:00Z'::timestamptz, false, '3680ead1-0000-4000-8000-0000000000c1',
    '36800000-0000-4000-8000-00000000000c'),
  '(CA) deleted_at sozinho já tira o lead da coorte');

SELECT ok(
  NOT public._metric_lead_na_coorte(
    NULL, false, '3680ead1-0000-4000-8000-0000000000c5',
    '36800000-0000-4000-8000-00000000000c'),
  '(CA) lead só de funil custom, em org com a flag, fica fora');

-- ===========================================================================
-- (FL) a exclusão é POR ORG — a mesma forma conta na org sem a flag
-- ===========================================================================
SELECT ok(
  public._metric_lead_na_coorte(
    NULL, false, '3680ead1-0000-4000-8000-0000000000d1',
    '36800000-0000-4000-8000-00000000000d'),
  '(FL) o mesmo lead só-de-prospecção CONTA na org sem a flag');

SELECT is(
  (public._metric_leaf_leads_criados(
     '36800000-0000-4000-8000-00000000000d',
     'total',
     tstzrange('2027-08-01T00:00:00Z', '2027-09-01T00:00:00Z', '[)'),
     'America/Sao_Paulo',
     '{}'::jsonb) ->> 'value')::numeric,
  1::numeric,
  '(FL) org sem flag conta o lead que a org com flag descarta');

-- ===========================================================================
-- (ID) avaliados + não avaliados = criados
-- ===========================================================================
SELECT is(
  (public._metric_leaf_leads_qualidade(
     '36800000-0000-4000-8000-00000000000c', 'total',
     tstzrange('2027-08-01T00:00:00Z', '2027-09-01T00:00:00Z', '[)'),
     'America/Sao_Paulo', '{}'::jsonb, 'avaliados') ->> 'value')::numeric
  +
  (public._metric_leaf_leads_qualidade(
     '36800000-0000-4000-8000-00000000000c', 'total',
     tstzrange('2027-08-01T00:00:00Z', '2027-09-01T00:00:00Z', '[)'),
     'America/Sao_Paulo', '{}'::jsonb, 'nao_avaliados') ->> 'value')::numeric,
  (public._metric_leaf_leads_criados(
     '36800000-0000-4000-8000-00000000000c', 'total',
     tstzrange('2027-08-01T00:00:00Z', '2027-09-01T00:00:00Z', '[)'),
     'America/Sao_Paulo', '{}'::jsonb) ->> 'value')::numeric,
  '(ID) avaliados + não avaliados fecha em leads_criados');

-- ===========================================================================
-- (SD) leads_sem_responsavel usa a mesma coorte
-- ===========================================================================
-- C1 e C2 estão sem responsável; C3/C4/C5 saem pela coorte. Se o leaf voltasse
-- a decidir sozinho, este número passaria de 2.
SELECT is(
  (public._metric_leaf_leads_sem_dono(
     '36800000-0000-4000-8000-00000000000c', 'total', '{}'::jsonb) ->> 'value')::numeric,
  2::numeric,
  '(SD) leads_sem_responsavel enxerga a mesma coorte de 2');

-- ===========================================================================
-- (UM) o predicado é escrito num lugar só
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('_metric_leaf_leads_criados', '_metric_leaf_leads_qualidade',
                       '_metric_leaf_leads_sem_dono')
     AND pg_get_functiondef(p.oid) LIKE '%l.deleted_at IS NULL%'),
  0,
  '(UM) nenhum leaf de entrada escreve o predicado de coorte à mão');

SELECT is(
  (SELECT count(*)::int FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('_metric_leaf_leads_criados', '_metric_leaf_leads_qualidade',
                       '_metric_leaf_leads_sem_dono')
     AND pg_get_functiondef(p.oid) LIKE '%_metric_lead_na_coorte%'),
  3,
  '(UM) os três leaves de entrada chamam a coorte canônica');

-- ===========================================================================
-- (GR) a coorte é interna
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('anon',
    'public._metric_lead_na_coorte(timestamptz, boolean, uuid, uuid)'::regprocedure, 'EXECUTE'),
  '(GR) anon não executa a coorte canônica');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public._metric_lead_na_coorte(timestamptz, boolean, uuid, uuid)'::regprocedure, 'EXECUTE'),
  '(GR) authenticated não executa a coorte canônica');

SELECT ok(
  has_function_privilege('service_role',
    'public._metric_lead_na_coorte(timestamptz, boolean, uuid, uuid)'::regprocedure, 'EXECUTE'),
  '(GR) service_role executa a coorte canônica — sem isso o motor não roda');

SELECT * FROM finish();
ROLLBACK;
