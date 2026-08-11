-- supabase/tests/metric_tempo_resposta_test.sql
--
-- SCRUM-311, fatia 6: `tempo_resposta_equipe`.
--
-- O que esta suíte protege:
--
--   (PA) o PAREAMENTO. Para cada recebida, a PRÓXIMA enviada em até 12h. Os
--        dois casos que quebram isso na vida real estão plantados: a resposta
--        tardia (fora do teto) e a rajada (cinco enviadas seguidas, que sem
--        DISTINCT ON contariam cinco atendimentos).
--   (FH) o EXPEDIENTE no fuso da ORG. Uma recebida às 20h UTC = 17h BRT está
--        DENTRO do expediente local e FORA do 8..18 em UTC. É o desvio nº 2 da
--        fonte legada, e este caso é o que prova que o porte o corrigiu.
--   (JA) a JANELA recorta a MENSAGEM. Mensagem de lead antigo, fora do período,
--        não entra — desvio nº 1.
--   (RG) regressão: receita e num_vendas sobrevivem à reescrita do despachante.
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
INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('31170000-0000-4000-8000-00000000000a', 'Org TR A', 'org-tr-a', 'America/Sao_Paulo'),
  ('31170000-0000-4000-8000-00000000000b', 'Org TR B', 'org-tr-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('3117115e-0000-4000-8000-00000000000a', 'user-3117a@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', ''),
  ('3117115e-0000-4000-8000-00000000000b', 'user-3117b@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('31171ea9-0000-4000-8000-00000000000a', '31170000-0000-4000-8000-00000000000a',
   '3117115e-0000-4000-8000-00000000000a', 'Membro TR A', 'member', true),
  ('31171ea9-0000-4000-8000-00000000000b', '31170000-0000-4000-8000-00000000000b',
   '3117115e-0000-4000-8000-00000000000b', 'Membro TR B', 'member', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name, origin, created_at) VALUES
  ('3117ead1-0000-4000-8000-000000000001', '31170000-0000-4000-8000-00000000000a', 'Lead 1', 'meta_ads',  '2027-07-01T12:00:00Z'),
  ('3117ead1-0000-4000-8000-000000000002', '31170000-0000-4000-8000-00000000000a', 'Lead 2', 'indicacao', '2027-07-01T12:00:00Z'),
  ('3117ead1-0000-4000-8000-000000000003', '31170000-0000-4000-8000-00000000000a', 'Lead 3', 'meta_ads',  '2027-07-01T12:00:00Z'),
  ('3117ead1-0000-4000-8000-0000000000b1', '31170000-0000-4000-8000-00000000000b', 'Lead B', 'meta_ads',  '2027-07-01T12:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- Todos os instantes em UTC. A org é America/Sao_Paulo (UTC-3).
--
-- Lead 1 — par simples: recebida 14:00Z (11h local, expediente), resposta
--          14:10Z → 600s.
-- Lead 2 — RAJADA: recebida 15:00Z (12h local), cinco enviadas 15:05Z..15:25Z.
--          Só a primeira conta → 300s. Sem DISTINCT ON contaria cinco.
-- Lead 3 — resposta TARDIA: recebida 16:00Z, resposta 30h depois. Fora do teto
--          de 12h → o par não existe, e o lead não entra na média.
-- Lead 1 — FORA DA JANELA: recebida em junho, respondida em junho. A janela do
--          teste é julho.
-- Lead 1 — EXPEDIENTE LOCAL: recebida 20:00Z = 17h local (DENTRO do expediente
--          da org, FORA do 8..18 em UTC), resposta 20:02Z → 120s.
--          É este par que o legado perdia.
--
-- Pares válidos em julho: 600, 300, 120 → média 340.
INSERT INTO public.whatsapp_messages
  (id, organization_id, lead_id, message_id, remote_jid, phone_number, direction, timestamp) VALUES
  -- Lead 1 par simples
  ('3117aaaa-0000-4000-8000-000000000001', '31170000-0000-4000-8000-00000000000a', '3117ead1-0000-4000-8000-000000000001', 'm1',  '55119@s.w', '55119', 'incoming', '2027-07-05T14:00:00Z'),
  ('3117aaaa-0000-4000-8000-000000000002', '31170000-0000-4000-8000-00000000000a', '3117ead1-0000-4000-8000-000000000001', 'm2',  '55119@s.w', '55119', 'outgoing', '2027-07-05T14:10:00Z'),
  -- Lead 2 rajada
  ('3117aaaa-0000-4000-8000-000000000010', '31170000-0000-4000-8000-00000000000a', '3117ead1-0000-4000-8000-000000000002', 'm10', '55118@s.w', '55118', 'incoming', '2027-07-06T15:00:00Z'),
  ('3117aaaa-0000-4000-8000-000000000011', '31170000-0000-4000-8000-00000000000a', '3117ead1-0000-4000-8000-000000000002', 'm11', '55118@s.w', '55118', 'outgoing', '2027-07-06T15:05:00Z'),
  ('3117aaaa-0000-4000-8000-000000000012', '31170000-0000-4000-8000-00000000000a', '3117ead1-0000-4000-8000-000000000002', 'm12', '55118@s.w', '55118', 'outgoing', '2027-07-06T15:10:00Z'),
  ('3117aaaa-0000-4000-8000-000000000013', '31170000-0000-4000-8000-00000000000a', '3117ead1-0000-4000-8000-000000000002', 'm13', '55118@s.w', '55118', 'outgoing', '2027-07-06T15:15:00Z'),
  ('3117aaaa-0000-4000-8000-000000000014', '31170000-0000-4000-8000-00000000000a', '3117ead1-0000-4000-8000-000000000002', 'm14', '55118@s.w', '55118', 'outgoing', '2027-07-06T15:20:00Z'),
  ('3117aaaa-0000-4000-8000-000000000015', '31170000-0000-4000-8000-00000000000a', '3117ead1-0000-4000-8000-000000000002', 'm15', '55118@s.w', '55118', 'outgoing', '2027-07-06T15:25:00Z'),
  -- Lead 3 resposta tardia (30h)
  ('3117aaaa-0000-4000-8000-000000000020', '31170000-0000-4000-8000-00000000000a', '3117ead1-0000-4000-8000-000000000003', 'm20', '55117@s.w', '55117', 'incoming', '2027-07-07T16:00:00Z'),
  ('3117aaaa-0000-4000-8000-000000000021', '31170000-0000-4000-8000-00000000000a', '3117ead1-0000-4000-8000-000000000003', 'm21', '55117@s.w', '55117', 'outgoing', '2027-07-08T22:00:00Z'),
  -- Fora da janela (junho)
  ('3117aaaa-0000-4000-8000-000000000030', '31170000-0000-4000-8000-00000000000a', '3117ead1-0000-4000-8000-000000000001', 'm30', '55119@s.w', '55119', 'incoming', '2027-06-10T14:00:00Z'),
  ('3117aaaa-0000-4000-8000-000000000031', '31170000-0000-4000-8000-00000000000a', '3117ead1-0000-4000-8000-000000000001', 'm31', '55119@s.w', '55119', 'outgoing', '2027-06-10T14:01:00Z'),
  -- Expediente LOCAL: 20:00Z = 17h em Sao_Paulo
  ('3117aaaa-0000-4000-8000-000000000040', '31170000-0000-4000-8000-00000000000a', '3117ead1-0000-4000-8000-000000000001', 'm40', '55119@s.w', '55119', 'incoming', '2027-07-09T20:00:00Z'),
  ('3117aaaa-0000-4000-8000-000000000041', '31170000-0000-4000-8000-00000000000a', '3117ead1-0000-4000-8000-000000000001', 'm41', '55119@s.w', '55119', 'outgoing', '2027-07-09T20:02:00Z'),
  -- Org B: um par de 60s, só para provar que não vaza
  ('3117aaaa-0000-4000-8000-0000000000b1', '31170000-0000-4000-8000-00000000000b', '3117ead1-0000-4000-8000-0000000000b1', 'mb1', '55116@s.w', '55116', 'incoming', '2027-07-05T14:00:00Z'),
  ('3117aaaa-0000-4000-8000-0000000000b2', '31170000-0000-4000-8000-00000000000b', '3117ead1-0000-4000-8000-0000000000b1', 'mb2', '55116@s.w', '55116', 'outgoing', '2027-07-05T14:01:00Z')
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- (CT) Catálogo e (GR) grants
-- ===========================================================================
SELECT is(
  (SELECT unit FROM public.metric_catalog_measures WHERE id = 'tempo_resposta_equipe'),
  'duration_seconds', 'CT1: unidade é duração em segundos');

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.metric_catalog_measure_recortes
              WHERE measure_id = 'tempo_resposta_equipe' AND recorte_id IN ('closer','sdr')),
  'CT2: sem corte por pessoa nesta fatia — atribuição de quem respondeu é outro conceito');

SELECT ok(
  NOT has_function_privilege('anon',
    'public._metric_leaf_tempo_resposta(uuid, text, tstzrange, text, jsonb)'::regprocedure, 'EXECUTE'),
  'GR1: anon NÃO executa o leaf');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public._metric_leaf_tempo_resposta(uuid, text, tstzrange, text, jsonb)'::regprocedure, 'EXECUTE'),
  'GR2: authenticated NÃO executa o leaf');

SELECT ok(
  has_function_privilege('service_role',
    'public._metric_leaf_tempo_resposta(uuid, text, tstzrange, text, jsonb)'::regprocedure, 'EXECUTE'),
  'GR3: service_role executa');

-- ===========================================================================
-- Como membro de A
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"3117115e-0000-4000-8000-00000000000a","role":"authenticated"}', true);

-- ===========================================================================
-- (PA) Pareamento
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('31170000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"tempo_resposta_equipe"}'::jsonb, 'total', 'range', NULL,
     '2027-07-01'::date, '2027-07-31'::date) ->> 'value')::numeric,
  340::numeric,
  'PA1: média dos 3 pares válidos = (600 + 300 + 120) / 3 = 340s');

-- Se o DISTINCT ON falhasse, a rajada do Lead 2 entraria com 5 pares
-- (300,600,900,1200,1500) e a média subiria para 771. O número 340 é o que
-- prova que uma recebida gera UM atendimento.
SELECT isnt(
  (public.fn_metric_measure('31170000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"tempo_resposta_equipe"}'::jsonb, 'total', 'range', NULL,
     '2027-07-01'::date, '2027-07-31'::date) ->> 'value')::numeric,
  771::numeric,
  'PA2: a rajada de 5 enviadas conta UM atendimento, não cinco');

-- ===========================================================================
-- (FH) Expediente no fuso da org — o desvio nº 2, corrigido
-- ===========================================================================
-- A recebida das 20:00Z (17h em São Paulo) É expediente local. No legado, que
-- filtra 8..18 em UTC, ela ficava de fora e o par de 120s sumia — puxando a
-- média para (600+300)/2 = 450.
SELECT isnt(
  (public.fn_metric_measure('31170000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"tempo_resposta_equipe"}'::jsonb, 'total', 'range', NULL,
     '2027-07-01'::date, '2027-07-31'::date) ->> 'value')::numeric,
  450::numeric,
  'FH1: 17h local conta como expediente — o filtro é no fuso da org, não em UTC');

-- ===========================================================================
-- (JA) A janela recorta a mensagem — o desvio nº 1
-- ===========================================================================
-- O par de junho (60s) pertence a um lead que também tem mensagens em julho.
-- Se a janela recortasse o LEAD, como no legado, ele entraria e a média cairia.
SELECT is(
  (public.fn_metric_measure('31170000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"tempo_resposta_equipe"}'::jsonb, 'total', 'range', NULL,
     '2027-06-01'::date, '2027-06-30'::date) ->> 'value')::numeric,
  60::numeric,
  'JA1: junho devolve só o par de junho — a janela corta a mensagem, não o lead');

-- ===========================================================================
-- (SR) Séries
-- ===========================================================================
SELECT is(
  public.fn_metric_measure('31170000-0000-4000-8000-00000000000a',
    '{"kind":"leaf","id":"tempo_resposta_equipe"}'::jsonb, 'origem', 'range', NULL,
    '2027-07-01'::date, '2027-07-31'::date) -> 'value',
  'null'::jsonb, 'SR1: com recorte, value vem null');

SELECT is(
  jsonb_array_length(
    public.fn_metric_measure('31170000-0000-4000-8000-00000000000a',
      '{"kind":"leaf","id":"tempo_resposta_equipe"}'::jsonb, 'origem', 'range', NULL,
      '2027-07-01'::date, '2027-07-31'::date) -> 'series'),
  2, 'SR2: duas origens entre os pares válidos (meta_ads e indicacao)');

-- ===========================================================================
-- (RG) Regressão do despachante
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('31170000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"leads_criados"}'::jsonb, 'total', 'range', NULL,
     '2027-07-01'::date, '2027-07-31'::date) ->> 'value')::numeric,
  3::numeric, 'RG1: leads_criados sobreviveu à reescrita');

SELECT is(
  (public.fn_metric_measure('31170000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"receita"}'::jsonb, 'total', 'range', NULL,
     '2027-07-01'::date, '2027-07-31'::date) ->> 'value')::numeric,
  0::numeric, 'RG2: receita responde (0 neste fixture) — o ramo dela existe');

-- ===========================================================================
-- (XO) Cross-org
-- ===========================================================================
SELECT throws_ok(
  $$SELECT public.fn_metric_measure(
      '31170000-0000-4000-8000-00000000000b',
      '{"kind":"leaf","id":"tempo_resposta_equipe"}'::jsonb, 'total', 'range', NULL,
      '2027-07-01'::date, '2027-07-31'::date)$$,
  'P0001', NULL,
  'XO1: membro de A é BLOQUEADO na org B');

SELECT set_config('request.jwt.claims',
  '{"sub":"3117115e-0000-4000-8000-00000000000b","role":"authenticated"}', true);

SELECT is(
  (public.fn_metric_measure('31170000-0000-4000-8000-00000000000b',
     '{"kind":"leaf","id":"tempo_resposta_equipe"}'::jsonb, 'total', 'range', NULL,
     '2027-07-01'::date, '2027-07-31'::date) ->> 'value')::numeric,
  60::numeric, 'XO2: org B mede só o próprio par');

SELECT * FROM finish();
ROLLBACK;
