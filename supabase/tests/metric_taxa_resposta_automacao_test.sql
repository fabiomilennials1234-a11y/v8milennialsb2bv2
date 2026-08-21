-- supabase/tests/metric_taxa_resposta_automacao_test.sql
--
-- SCRUM-421 — disparos de automação entregues, e os que voltaram em 72h.
--
-- O que esta suíte guarda:
--
--   (EN) o denominador é ENTREGUE, não enviado. `sent` sem recibo fica fora —
--        é 40% do volume em produção, e a decisão do CTO foi explícita: incluir
--        o que não se sabe infla o denominador.
--   (AU) `manual` não é automação. A pergunta é sobre o que a MÁQUINA disparou.
--   (72) a janela é 72h A PARTIR DO DISPARO. Resposta no dia 4 não conta, e
--        resposta ANTERIOR ao disparo também não — senão qualquer conversa
--        antiga transformaria o disparo seguinte em "respondido".
--   (SB) o numerador é SUBCONJUNTO do denominador por construção. Se alguém
--        escrever dois leaves separados, este caso é o primeiro a quebrar.
--   (D0) org sem disparo de automação é AUSÊNCIA, não zero.
--   (GR) a função é interna.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('42100000-0000-4000-8000-00000000000a', 'Org AUT A', 'org-aut-a', 'America/Sao_Paulo'),
  ('42100000-0000-4000-8000-00000000000c', 'Org AUT sem automacao', 'org-aut-c', 'America/Sao_Paulo')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO public.leads (id, organization_id, name, origin) VALUES
  ('4210ead1-0000-4000-8000-000000000001', '42100000-0000-4000-8000-00000000000a', 'Respondeu em 2h',    'meta_ads'),
  ('4210ead1-0000-4000-8000-000000000002', '42100000-0000-4000-8000-00000000000a', 'Respondeu no dia 4', 'meta_ads'),
  ('4210ead1-0000-4000-8000-000000000003', '42100000-0000-4000-8000-00000000000a', 'Nao respondeu',      'indicacao'),
  ('4210ead1-0000-4000-8000-000000000004', '42100000-0000-4000-8000-00000000000a', 'So sent, sem recibo','indicacao'),
  ('4210ead1-0000-4000-8000-000000000005', '42100000-0000-4000-8000-00000000000a', 'Disparo manual',     'indicacao')
ON CONFLICT (id) DO NOTHING;

-- O CADERNO. Tudo em julho/2027, dentro da janela dos testes.
--
--   L1  workflow delivered 10/07 12h + resposta 10/07 14h   → entregue E respondido
--   L2  workflow read      11/07 12h + resposta 15/07 12h   → entregue, NÃO respondido (72)
--   L3  copilot  delivered 12/07 12h, sem resposta          → entregue, NÃO respondido
--   L4  workflow sent      13/07 12h + resposta 13/07 13h   → NÃO entregue (EN)
--   L5  manual   delivered 14/07 12h + resposta 14/07 13h   → não é automação (AU)
--   L3b resposta ANTES do disparo (11/07) não vale          → (72)
INSERT INTO public.whatsapp_messages
  (id, organization_id, instance_id, message_id, remote_jid, phone_number, direction,
   message_type, content, lead_id, timestamp, status, sent_source, sent_by_ai, deleted_at) VALUES
-- ⚠ `sent_source` é NOT NULL com DEFAULT 'manual'. Passar NULL explícito
-- DERRUBA o default e viola a constraint — a mensagem de entrada leva 'manual',
-- que é o que produção grava.
 (gen_random_uuid(),'42100000-0000-4000-8000-00000000000a',NULL,'a-l1','x@s.w','5511910000001','outgoing','text','oi','4210ead1-0000-4000-8000-000000000001','2027-07-10 12:00-03','delivered','workflow',true,NULL),
 (gen_random_uuid(),'42100000-0000-4000-8000-00000000000a',NULL,'r-l1','x@s.w','5511910000001','incoming','text','oi!','4210ead1-0000-4000-8000-000000000001','2027-07-10 14:00-03','read','manual',false,NULL),
 (gen_random_uuid(),'42100000-0000-4000-8000-00000000000a',NULL,'a-l2','x@s.w','5511910000002','outgoing','text','oi','4210ead1-0000-4000-8000-000000000002','2027-07-11 12:00-03','read','workflow',true,NULL),
 (gen_random_uuid(),'42100000-0000-4000-8000-00000000000a',NULL,'r-l2','x@s.w','5511910000002','incoming','text','oi!','4210ead1-0000-4000-8000-000000000002','2027-07-15 12:00-03','read','manual',false,NULL),
 (gen_random_uuid(),'42100000-0000-4000-8000-00000000000a',NULL,'r-l3-antes','x@s.w','5511910000003','incoming','text','ola','4210ead1-0000-4000-8000-000000000003','2027-07-11 12:00-03','read','manual',false,NULL),
 (gen_random_uuid(),'42100000-0000-4000-8000-00000000000a',NULL,'a-l3','x@s.w','5511910000003','outgoing','text','oi','4210ead1-0000-4000-8000-000000000003','2027-07-12 12:00-03','delivered','copilot',true,NULL),
 (gen_random_uuid(),'42100000-0000-4000-8000-00000000000a',NULL,'a-l4','x@s.w','5511910000004','outgoing','text','oi','4210ead1-0000-4000-8000-000000000004','2027-07-13 12:00-03','sent','workflow',true,NULL),
 (gen_random_uuid(),'42100000-0000-4000-8000-00000000000a',NULL,'r-l4','x@s.w','5511910000004','incoming','text','oi!','4210ead1-0000-4000-8000-000000000004','2027-07-13 13:00-03','read','manual',false,NULL),
 (gen_random_uuid(),'42100000-0000-4000-8000-00000000000a',NULL,'a-l5','x@s.w','5511910000005','outgoing','text','oi','4210ead1-0000-4000-8000-000000000005','2027-07-14 12:00-03','delivered','manual',false,NULL),
 (gen_random_uuid(),'42100000-0000-4000-8000-00000000000a',NULL,'r-l5','x@s.w','5511910000005','incoming','text','oi!','4210ead1-0000-4000-8000-000000000005','2027-07-14 13:00-03','read','manual',false,NULL);

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (EN) + (AU): o denominador
-- ===========================================================================
SELECT is(
  (public._metric_leaf_automacao(
     '42100000-0000-4000-8000-00000000000a', 'total',
     tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb, 'entregues') ->> 'value')::numeric,
  3::numeric,
  '(EN/AU) entregues = 3 — o `sent` sem recibo e o `manual` ficam fora');

-- ===========================================================================
-- (72): o numerador
-- ===========================================================================
SELECT is(
  (public._metric_leaf_automacao(
     '42100000-0000-4000-8000-00000000000a', 'total',
     tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb, 'respondidos') ->> 'value')::numeric,
  1::numeric,
  '(72) respondidos = 1 — o do dia 4 e o que respondeu ANTES do disparo não contam');

-- ===========================================================================
-- (SB) subconjunto
-- ===========================================================================
SELECT ok(
  (public._metric_leaf_automacao(
     '42100000-0000-4000-8000-00000000000a', 'total',
     tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb, 'respondidos') ->> 'value')::numeric
  <=
  (public._metric_leaf_automacao(
     '42100000-0000-4000-8000-00000000000a', 'total',
     tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb, 'entregues') ->> 'value')::numeric,
  '(SB) respondidos nunca passa entregues — a taxa não pode passar de 100%');

-- ===========================================================================
-- (D0) org sem automação é ausência
-- ===========================================================================
SELECT is(
  (public._metric_leaf_automacao(
     '42100000-0000-4000-8000-00000000000c', 'total',
     tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb, 'entregues') ->> 'empty_reason'),
  'no_rows', '(D0) org sem disparo de automação devolve ausência');

-- ===========================================================================
-- Critério fechado
-- ===========================================================================
SELECT throws_ok(
  $$ SELECT public._metric_leaf_automacao(
       '42100000-0000-4000-8000-00000000000a', 'total',
       tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
       'America/Sao_Paulo', '{}'::jsonb, 'inventado') $$,
  '22023', NULL,
  '(RE) critério fora do conjunto levanta 22023');

-- ===========================================================================
-- Recorte por origem
-- ===========================================================================
SELECT is(
  (SELECT (s->>'value')::numeric
     FROM jsonb_array_elements(
       public._metric_leaf_automacao(
         '42100000-0000-4000-8000-00000000000a', 'origem',
         tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
         'America/Sao_Paulo', '{}'::jsonb, 'entregues') -> 'series') s
    WHERE s->>'key' = 'meta_ads'),
  2::numeric, '(origem) meta_ads entregou 2');

-- ===========================================================================
-- (GR) interna
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('anon',
    'public._metric_leaf_automacao(uuid, text, tstzrange, text, jsonb, text)'::regprocedure, 'EXECUTE'),
  '(GR) anon não executa');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public._metric_leaf_automacao(uuid, text, tstzrange, text, jsonb, text)'::regprocedure, 'EXECUTE'),
  '(GR) authenticated não executa');

SELECT ok(
  has_function_privilege('service_role',
    'public._metric_leaf_automacao(uuid, text, tstzrange, text, jsonb, text)'::regprocedure, 'EXECUTE'),
  '(GR) service_role executa');

SELECT * FROM finish();
ROLLBACK;
