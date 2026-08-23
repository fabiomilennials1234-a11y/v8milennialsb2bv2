-- supabase/tests/metric_clientes_sem_resposta_test.sql
--
-- SCRUM-419 — clientes cuja ÚLTIMA mensagem é nossa há 3 dias ou mais.
--
-- O que esta suíte guarda:
--
--   (UL) o predicado é sobre a ÚLTIMA mensagem, não sobre existir alguma nossa.
--        Um lead que respondeu ontem depois de três dias parado NÃO está sem
--        resposta — e um `EXISTS` de outgoing antiga o contaria. É o caso que
--        separa esta medida de uma consulta ingênua.
--   (JA) três dias é a régua: dois dias ainda não conta.
--   (AP) mensagem APAGADA não manda. Se a última foi apagada, a anterior é que
--        vale — senão o lead fica eternamente "sem resposta" por causa de algo
--        que ninguém mais vê.
--   (CO) usa a coorte canônica: sombra e lead marcado fora das métricas não
--        entram na fila.
--   (D0) org sem conversa nenhuma é AUSÊNCIA, não zero. "Zero esperando"
--        afirma que a operação está em dia.
--   (XO) isolamento cross-org.
--   (GR) a função é interna.
--
-- As mensagens são semeadas em relação a `now()` porque a régua é o relógio.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('41900000-0000-4000-8000-00000000000a', 'Org CSR A', 'org-csr-a', 'America/Sao_Paulo'),
  ('41900000-0000-4000-8000-00000000000b', 'Org CSR B', 'org-csr-b', 'America/Sao_Paulo'),
  ('41900000-0000-4000-8000-00000000000c', 'Org CSR C sem conversa', 'org-csr-c', 'America/Sao_Paulo')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO public.leads (id, organization_id, name, origin, is_shadow, deleted_at) VALUES
  ('4190ead1-0000-4000-8000-000000000001', '41900000-0000-4000-8000-00000000000a', 'Esperando ha 5 dias', 'meta_ads', false, NULL),
  ('4190ead1-0000-4000-8000-000000000002', '41900000-0000-4000-8000-00000000000a', 'Respondeu ontem',      'meta_ads', false, NULL),
  ('4190ead1-0000-4000-8000-000000000003', '41900000-0000-4000-8000-00000000000a', 'Nossa ha 2 dias',      'indicacao', false, NULL),
  ('4190ead1-0000-4000-8000-000000000004', '41900000-0000-4000-8000-00000000000a', 'Ultima apagada',       'indicacao', false, NULL),
  ('4190ead1-0000-4000-8000-000000000005', '41900000-0000-4000-8000-00000000000a', 'Sombra do copilot',    'copilot',  true,  NULL),
  ('4190ead1-0000-4000-8000-0000000000b1', '41900000-0000-4000-8000-00000000000b', 'Lead da org B',        'meta_ads', false, NULL)
ON CONFLICT (id) DO NOTHING;

-- O CADERNO DE MENSAGENS
--
--   L1  nossa há 5 dias                          → CONTA
--   L2  nossa há 5 dias, resposta dele há 1 dia  → não conta (UL)
--   L3  nossa há 2 dias                          → não conta (JA)
--   L4  nossa há 5 dias, e uma nossa há 1 dia APAGADA → CONTA pela de 5 (AP)
--   L5  nossa há 5 dias, mas é SOMBRA            → não conta (CO)
--   B1  nossa há 5 dias, org B                   → não conta para a org A (XO)
INSERT INTO public.whatsapp_messages
  (id, organization_id, instance_id, message_id, remote_jid, phone_number, direction,
   message_type, content, lead_id, timestamp, deleted_at) VALUES
 (gen_random_uuid(), '41900000-0000-4000-8000-00000000000a', NULL, 'm-l1', 'x@s.w', '5511900000001', 'outgoing', 'text', 'oi',  '4190ead1-0000-4000-8000-000000000001', now() - interval '5 days', NULL),
 (gen_random_uuid(), '41900000-0000-4000-8000-00000000000a', NULL, 'm-l2a','x@s.w', '5511900000002', 'outgoing', 'text', 'oi',  '4190ead1-0000-4000-8000-000000000002', now() - interval '5 days', NULL),
 (gen_random_uuid(), '41900000-0000-4000-8000-00000000000a', NULL, 'm-l2b','x@s.w', '5511900000002', 'incoming', 'text', 'oi!', '4190ead1-0000-4000-8000-000000000002', now() - interval '1 day',  NULL),
 (gen_random_uuid(), '41900000-0000-4000-8000-00000000000a', NULL, 'm-l3', 'x@s.w', '5511900000003', 'outgoing', 'text', 'oi',  '4190ead1-0000-4000-8000-000000000003', now() - interval '2 days', NULL),
 (gen_random_uuid(), '41900000-0000-4000-8000-00000000000a', NULL, 'm-l4a','x@s.w', '5511900000004', 'outgoing', 'text', 'oi',  '4190ead1-0000-4000-8000-000000000004', now() - interval '5 days', NULL),
 (gen_random_uuid(), '41900000-0000-4000-8000-00000000000a', NULL, 'm-l4b','x@s.w', '5511900000004', 'outgoing', 'text', 'ops', '4190ead1-0000-4000-8000-000000000004', now() - interval '1 day',  now()),
 (gen_random_uuid(), '41900000-0000-4000-8000-00000000000a', NULL, 'm-l5', 'x@s.w', '5511900000005', 'outgoing', 'text', 'oi',  '4190ead1-0000-4000-8000-000000000005', now() - interval '5 days', NULL),
 (gen_random_uuid(), '41900000-0000-4000-8000-00000000000b', NULL, 'm-b1', 'x@s.w', '5511900000009', 'outgoing', 'text', 'oi',  '4190ead1-0000-4000-8000-0000000000b1', now() - interval '5 days', NULL);

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (UL) + (JA) + (AP) + (CO): o número inteiro
-- ===========================================================================
SELECT is(
  (public._metric_leaf_clientes_sem_resposta(
     '41900000-0000-4000-8000-00000000000a', 'total', '{}'::jsonb) ->> 'value')::numeric,
  2::numeric,
  '(UL/JA/AP/CO) contam L1 e L4 — quem respondeu, quem tem 2 dias e a sombra ficam fora');

-- ===========================================================================
-- (XO) isolamento
-- ===========================================================================
SELECT is(
  (public._metric_leaf_clientes_sem_resposta(
     '41900000-0000-4000-8000-00000000000b', 'total', '{}'::jsonb) ->> 'value')::numeric,
  1::numeric, '(XO) a org B enxerga só o lead dela');

-- ===========================================================================
-- (D0) org sem conversa é ausência, não zero
-- ===========================================================================
SELECT is(
  (public._metric_leaf_clientes_sem_resposta(
     '41900000-0000-4000-8000-00000000000c', 'total', '{}'::jsonb) ->> 'empty_reason'),
  'no_rows', '(D0) org sem conversa nenhuma devolve ausência');

-- ===========================================================================
-- Recorte por origem: a fila dividida
-- ===========================================================================
SELECT is(
  (SELECT (s->>'value')::numeric
     FROM jsonb_array_elements(
       public._metric_leaf_clientes_sem_resposta(
         '41900000-0000-4000-8000-00000000000a', 'origem', '{}'::jsonb) -> 'series') s
    WHERE s->>'key' = 'meta_ads'),
  1::numeric, '(origem) meta_ads tem 1 — L1');

SELECT is(
  (SELECT (s->>'value')::numeric
     FROM jsonb_array_elements(
       public._metric_leaf_clientes_sem_resposta(
         '41900000-0000-4000-8000-00000000000a', 'origem', '{}'::jsonb) -> 'series') s
    WHERE s->>'key' = 'indicacao'),
  1::numeric, '(origem) indicacao tem 1 — L4, o da mensagem apagada');

-- ===========================================================================
-- Filtro de origem restringe o total
-- ===========================================================================
SELECT is(
  (public._metric_leaf_clientes_sem_resposta(
     '41900000-0000-4000-8000-00000000000a', 'total',
     '{"origin":"meta_ads"}'::jsonb) ->> 'value')::numeric,
  1::numeric, '(filtro) só meta_ads devolve 1');

-- ===========================================================================
-- Recorte fechado
-- ===========================================================================
SELECT throws_ok(
  $$ SELECT public._metric_leaf_clientes_sem_resposta(
       '41900000-0000-4000-8000-00000000000a', 'closer', '{}'::jsonb) $$,
  '22023', NULL,
  '(RE) recorte fora do conjunto levanta 22023');

-- ===========================================================================
-- (GR) interna
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('anon',
    'public._metric_leaf_clientes_sem_resposta(uuid, text, jsonb)'::regprocedure, 'EXECUTE'),
  '(GR) anon não executa');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public._metric_leaf_clientes_sem_resposta(uuid, text, jsonb)'::regprocedure, 'EXECUTE'),
  '(GR) authenticated não executa');

SELECT ok(
  has_function_privilege('service_role',
    'public._metric_leaf_clientes_sem_resposta(uuid, text, jsonb)'::regprocedure, 'EXECUTE'),
  '(GR) service_role executa');

SELECT * FROM finish();
ROLLBACK;
