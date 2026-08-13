-- supabase/tests/metric_negocio_semantica_test.sql
--
-- SCRUM-311, fatia 9: as métricas passam a saber que LEAD ≠ NEGÓCIO.
-- Migration: 20270813100000_metric_negocio_semantica.sql
--
-- A ASSERÇÃO QUE ESTA SUÍTE EXISTE PARA FAZER
--
-- Um lead com DOIS negócios abertos:
--
--     "Negócios na etapa"  = 2   ← a unidade do funil (ADR-0023)
--     "Leads na etapa"     = 1   ← a pessoa, contada uma vez
--
-- Em produção, 2026-08-12, a diferença era 41.025 entradas para 36.073 leads —
-- 12% de erro num número de operação, com a mesma medida servindo aos dois
-- nomes. Se as duas contas voltarem a ser a mesma, (LN2) reprova.
--
-- O que cada bloco protege:
--
--   (LN) as DUAS contagens, e a diferença entre elas. O coração da fatia.
--   (SE) a série por etapa. Em `lead`, a soma dos baldes NÃO é o total — uma
--        pessoa com negócio em duas etapas conta 1 em cada e 1 no total. É a
--        aritmética correta de distinct por balde, e está afirmada aqui para
--        que ninguém a "conserte".
--   (NA) `negocios_abertos` conta ABERTURA na janela (`entered_at`), não estado
--        atual: o negócio fechado dentro da janela continua tendo sido aberto.
--   (CV) `conversao_negocio` = venda ÷ negócio aberto. Mesma unidade nos dois
--        lados — é o que a razão por LEAD não tem.
--   (CO) coerência unidade-derivada × formato-declarado em TODA linha de
--        `metric_catalog_ratios`. A guarda de 100× que a fatia 7 instalou,
--        reafirmada porque esta fatia acrescenta linha.
--   (DL) `sale_events.deal_id`: existe, é NULÁVEL, tem FK e índice, e NÃO tem
--        uma linha preenchida. Coluna de dinheiro com backfill é o que esta
--        fatia se proibiu de fazer.
--   (GR) grants: o snapshot de 4 argumentos é interno; o de 3 MORREU. Enquanto
--        ele viver, a conta antiga está a um CREATE OR REPLACE de distância.
--   (RG) regressão da RECEITA. Toda reescrita do despachante põe o caminho do
--        dinheiro em risco; esta afirma que `receita` e `num_vendas` seguem de pé.
--   (XO) isolamento cross-org nas duas metades: autorização e filtro.
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
  ('39130000-0000-4000-8000-00000000000a', 'Org NG A', 'org-ng-a', 'America/Sao_Paulo'),
  ('39130000-0000-4000-8000-00000000000b', 'Org NG B', 'org-ng-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

-- `fn_metric_measure` chama `assert_org_access`, que exige membro ATIVO da org.
INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('3913115e-0000-4000-8000-00000000000a', 'user-3913a@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', ''),
  ('3913115e-0000-4000-8000-00000000000b', 'user-3913b@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- 'member', não 'membro': o enum app_role não tem 'membro' (SCRUM-366).
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('39131ea9-0000-4000-8000-00000000000a', '39130000-0000-4000-8000-00000000000a',
   '3913115e-0000-4000-8000-00000000000a', 'Membro NG A', 'member', true),
  ('39131ea9-0000-4000-8000-00000000000b', '39130000-0000-4000-8000-00000000000b',
   '3913115e-0000-4000-8000-00000000000b', 'Membro NG B', 'member', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug, type, is_active) VALUES
  ('39139191-0000-4000-8000-00000000000a', '39130000-0000-4000-8000-00000000000a',
   'Funil NG A', 'funil-ng-a', 'custom', true),
  ('39139191-0000-4000-8000-00000000000b', '39130000-0000-4000-8000-00000000000b',
   'Funil NG B', 'funil-ng-b', 'custom', true)
ON CONFLICT (id) DO NOTHING;

-- O DESENHO, e é onde a fatia inteira se prova:
--
--   L1  DOIS negócios abertos, em etapas diferentes (novo, proposta)
--   L2  UM negócio aberto (novo)
--   L3  UM negócio FECHADO (closed_at) — aberto na janela, fora do estado atual
--
--   negocios_na_etapa (estado)   = 3   (2 de L1 + 1 de L2)
--   leads_na_etapa    (estado)   = 2   (L1, L2)
--   negocios_abertos  (janela)   = 4   (os 3 acima + o fechado, que FOI aberto)
INSERT INTO public.leads (id, organization_id, name, origin, created_at, metrics_period_at) VALUES
  ('3913ead1-0000-4000-8000-000000000001', '39130000-0000-4000-8000-00000000000a', 'Lead com dois negocios', 'meta_ads',  '2027-08-05T12:00:00Z', '2027-08-05T12:00:00Z'),
  ('3913ead1-0000-4000-8000-000000000002', '39130000-0000-4000-8000-00000000000a', 'Lead com um negocio',   'indicacao', '2027-08-06T12:00:00Z', '2027-08-06T12:00:00Z'),
  ('3913ead1-0000-4000-8000-000000000003', '39130000-0000-4000-8000-00000000000a', 'Lead com negocio fechado','meta_ads', '2027-08-07T12:00:00Z', '2027-08-07T12:00:00Z'),
  ('3913ead1-0000-4000-8000-0000000000b1', '39130000-0000-4000-8000-00000000000b', 'Lead da org B',         'meta_ads',  '2027-08-05T12:00:00Z', '2027-08-05T12:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, entered_at, closed_at) VALUES
  -- L1: dois negócios ABERTOS, etapas diferentes
  ('3913e177-0000-4000-8000-000000000001', '39130000-0000-4000-8000-00000000000a', '39139191-0000-4000-8000-00000000000a', '3913ead1-0000-4000-8000-000000000001', 'novo',     '2027-08-05T12:00:00Z', NULL),
  ('3913e177-0000-4000-8000-000000000002', '39130000-0000-4000-8000-00000000000a', '39139191-0000-4000-8000-00000000000a', '3913ead1-0000-4000-8000-000000000001', 'proposta', '2027-08-09T12:00:00Z', NULL),
  -- L2: um negócio aberto, mesma etapa de um dos de L1
  ('3913e177-0000-4000-8000-000000000003', '39130000-0000-4000-8000-00000000000a', '39139191-0000-4000-8000-00000000000a', '3913ead1-0000-4000-8000-000000000002', 'novo',     '2027-08-06T12:00:00Z', NULL),
  -- L3: aberto DENTRO da janela, fechado depois. Estado ≠ abertura.
  ('3913e177-0000-4000-8000-000000000004', '39130000-0000-4000-8000-00000000000a', '39139191-0000-4000-8000-00000000000a', '3913ead1-0000-4000-8000-000000000003', 'proposta', '2027-08-07T12:00:00Z', '2027-08-20T12:00:00Z'),
  -- Org B: existe para provar que A não a enxerga
  ('3913e177-0000-4000-8000-0000000000b1', '39130000-0000-4000-8000-00000000000b', '39139191-0000-4000-8000-00000000000b', '3913ead1-0000-4000-8000-0000000000b1', 'novo',     '2027-08-05T12:00:00Z', NULL)
ON CONFLICT (id) DO NOTHING;

-- Uma venda em agosto, para a conversão por negócio: 1 ÷ 4 = 25,00%.
INSERT INTO public.sale_events (id, organization_id, lead_id, pipeline_id, stage_key,
                                event_type, sold_at, sale_value, currency, revenue_stream, source) VALUES
  ('39135a1e-0000-4000-8000-000000000001', '39130000-0000-4000-8000-00000000000a',
   '3913ead1-0000-4000-8000-000000000003', '39139191-0000-4000-8000-00000000000a', 'proposta',
   'sale', '2027-08-20T12:00:00Z', 1000.00, 'BRL', 'novo_negocio', 'backfill')
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- (CT) O catálogo
-- ===========================================================================
SELECT is(
  (SELECT unit || '/' || anchor FROM public.metric_catalog_measures WHERE id = 'negocios_na_etapa'),
  'count/hoje',
  'CT1: negocios_na_etapa é contagem, ancorada no estado atual');

SELECT is(
  (SELECT unit || '/' || anchor FROM public.metric_catalog_measures WHERE id = 'negocios_abertos'),
  'count/entradas',
  'CT2: negocios_abertos é contagem, ancorada na janela de entrada');

SELECT like(
  (SELECT description FROM public.metric_catalog_measures WHERE id = 'leads_na_etapa'),
  '%PESSOAS distintas%',
  'CT3: a descrição de leads_na_etapa passou a dizer o que ela conta');

-- ===========================================================================
-- (DL) sale_events.deal_id — schema, e SÓ schema
-- ===========================================================================
SELECT has_column('public', 'sale_events', 'deal_id',
  'DL1: sale_events ganhou deal_id');

SELECT col_is_null('public', 'sale_events', 'deal_id',
  'DL2: deal_id é NULÁVEL — todo o histórico e todo produtor que ainda não conhece Negócio');

SELECT isnt_empty(
  $$SELECT 1 FROM pg_constraint
     WHERE conname = 'sale_events_deal_id_fkey' AND conrelid = 'public.sale_events'::regclass$$,
  'DL3: deal_id aponta para deals por FK');

SELECT isnt_empty(
  $$SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_sale_events_deal_id'$$,
  'DL4: o índice parcial existe');

-- A fatia se proibiu de fazer backfill: `deals` tem 0 linhas em prod e
-- `abrir_negocio` não está aplicada. Preencher aqui seria inventar vínculo.
SELECT is(
  (SELECT count(*) FROM public.sale_events WHERE deal_id IS NOT NULL),
  0::bigint,
  'DL5: NENHUMA linha de venda foi vinculada a negócio — a migration é schema, não dado');

-- ===========================================================================
-- (GR) Grants, e a morte do snapshot de 3 argumentos
-- ===========================================================================
SELECT ok(
  to_regprocedure('public._metric_leaf_stage_snapshot(uuid, text, jsonb)') IS NULL,
  'GR1: o snapshot de 3 argumentos MORREU — a conta antiga não sobreviveu à fatia');

SELECT ok(
  to_regprocedure('public._metric_leaf_stage_snapshot(uuid, text, jsonb, text)') IS NOT NULL,
  'GR2: o snapshot de 4 argumentos, com a unidade explícita, existe');

SELECT ok(
  NOT has_function_privilege('anon',
    'public._metric_leaf_stage_snapshot(uuid, text, jsonb, text)'::regprocedure, 'EXECUTE'),
  'GR3: anon não executa o snapshot');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public._metric_leaf_stage_snapshot(uuid, text, jsonb, text)'::regprocedure, 'EXECUTE'),
  'GR4: authenticated não executa o snapshot — é interno, recebe org_id por parâmetro');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public._metric_leaf_negocios_abertos(uuid, text, tstzrange, text, jsonb)'::regprocedure, 'EXECUTE'),
  'GR5: authenticated não executa a leaf de negócios abertos');

SELECT ok(
  has_function_privilege('authenticated',
    'public.fn_metric_measure(uuid, jsonb, text, text, date, date, date, jsonb)'::regprocedure, 'EXECUTE'),
  'GR6: o caminho público continua aberto a quem usa o produto');

-- ===========================================================================
-- Daqui em diante como MEMBRO DE A — o caminho real do navegador
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"3913115e-0000-4000-8000-00000000000a","role":"authenticated"}', true);

-- ===========================================================================
-- (LN) LEAD ≠ NEGÓCIO — a asserção que a fatia existe para fazer
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('39130000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"negocios_na_etapa"}'::jsonb, 'total') ->> 'value')::numeric,
  3::numeric,
  'LN1: "Negócios na etapa" conta NEGÓCIO — 2 de um lead + 1 de outro = 3');

SELECT is(
  (public.fn_metric_measure('39130000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"leads_na_etapa"}'::jsonb, 'total') ->> 'value')::numeric,
  2::numeric,
  'LN2: "Leads na etapa" conta PESSOA — o lead com dois negócios conta UMA vez');

-- A diferença é o defeito de produção reproduzido em miniatura: 3 ≠ 2 aqui,
-- 41.025 ≠ 36.073 lá. Se as duas voltarem a ser iguais, a fatia foi desfeita.
SELECT isnt(
  (public.fn_metric_measure('39130000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"negocios_na_etapa"}'::jsonb, 'total') ->> 'value')::numeric,
  (public.fn_metric_measure('39130000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"leads_na_etapa"}'::jsonb, 'total') ->> 'value')::numeric,
  'LN3: as duas medidas NÃO devolvem o mesmo número — era esse o defeito');

-- O negócio fechado não está em etapa nenhuma, nas duas contagens.
SELECT is(
  (public.fn_metric_measure('39130000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"negocios_na_etapa"}'::jsonb, 'total') -> 'series')::text,
  'null',
  'LN4: recorte total devolve escalar e series null (value XOR series)');

-- ===========================================================================
-- (SE) A série por etapa, e a não-aditividade do distinct
-- ===========================================================================
SELECT is(
  (SELECT (s->>'value')::numeric
     FROM jsonb_array_elements(
       public.fn_metric_measure('39130000-0000-4000-8000-00000000000a',
         '{"kind":"leaf","id":"negocios_na_etapa"}'::jsonb, 'etapa') -> 'series') s
    WHERE s->>'key' = 'novo'),
  2::numeric,
  'SE1: por etapa, "novo" tem 2 NEGÓCIOS (um de cada lead)');

SELECT is(
  (SELECT (s->>'value')::numeric
     FROM jsonb_array_elements(
       public.fn_metric_measure('39130000-0000-4000-8000-00000000000a',
         '{"kind":"leaf","id":"negocios_na_etapa"}'::jsonb, 'etapa') -> 'series') s
    WHERE s->>'key' = 'proposta'),
  1::numeric,
  'SE2: por etapa, "proposta" tem 1 negócio aberto — o fechado saiu');

-- ⚠ A soma dos baldes de `leads_na_etapa` é 3, e o total é 2. NÃO é defeito: o
-- lead com negócio em duas etapas conta 1 em CADA balde e 1 no total. Está
-- afirmado para que ninguém "conserte" somando a série.
SELECT is(
  (SELECT sum((s->>'value')::numeric)
     FROM jsonb_array_elements(
       public.fn_metric_measure('39130000-0000-4000-8000-00000000000a',
         '{"kind":"leaf","id":"leads_na_etapa"}'::jsonb, 'etapa') -> 'series') s),
  3::numeric,
  'SE3: a soma da série de leads (3) NÃO é o total (2) — distinct por balde, de propósito');

-- ===========================================================================
-- (NA) negocios_abertos: abertura na janela, não estado atual
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('39130000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"negocios_abertos"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  4::numeric,
  'NA1: 4 negócios foram ABERTOS na janela — inclusive o que fechou depois');

SELECT is(
  (public.fn_metric_measure('39130000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"negocios_abertos"}'::jsonb, 'total', 'range', NULL,
     '2027-09-01'::date, '2027-09-30'::date) ->> 'empty_reason'),
  'no_rows',
  'NA2: janela sem abertura devolve ausência — travessão na tela, nunca zero');

SELECT is(
  (public.fn_metric_measure('39130000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"negocios_abertos"}'::jsonb, 'total', 'range', NULL,
     '2027-09-01'::date, '2027-09-30'::date) -> 'value')::text,
  'null',
  'NA3: e o valor é null, não 0 — "não houve" não é "houve zero"');

-- ===========================================================================
-- (CV) Conversão na unidade do funil
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('39130000-0000-4000-8000-00000000000a',
     '{"kind":"ratio","num":"num_vendas","den":"negocios_abertos"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  25.00::numeric,
  'CV1: 1 venda ÷ 4 negócios abertos = 25% — mesma unidade nos dois lados');

SELECT is(
  (SELECT num_measure_id || ' / ' || den_measure_id || ' / ' || format_id
     FROM public.metric_catalog_ratios WHERE id = 'conversao_negocio'),
  'num_vendas / negocios_abertos / percent_1',
  'CV2: o preset está no catálogo e é descobrível');

SELECT is(
  (SELECT label FROM public.metric_catalog_ratios WHERE id = 'conversao'),
  'Taxa de conversão por lead',
  'CV3: a conversão velha ganhou o nome do que ela divide — LEAD, não negócio');

-- ===========================================================================
-- (CO) Coerência unidade-derivada × formato-declarado, em TODAS as linhas
-- ===========================================================================
-- Mesma regra do motor, transcrita. Linha incoerente não quebra: ela MENTE por
-- 100×. Esta asserção roda em TODO CI, não só no dia do apply.
SELECT is_empty(
  $$
  SELECT r.id
    FROM public.metric_catalog_ratios r
    JOIN public.metric_catalog_measures mn ON mn.id = r.num_measure_id
    JOIN public.metric_catalog_measures md ON md.id = r.den_measure_id
   WHERE r.format_id <> CASE
           WHEN mn.unit = 'count'    AND md.unit = 'count' THEN 'percent_1'
           WHEN mn.unit = 'currency' AND md.unit = 'count' THEN 'currency_brl'
           ELSE 'ratio_2'
         END
  $$,
  'CO1: nenhuma razão declara formato incoerente com a unidade que o motor deriva');

-- ===========================================================================
-- (RG) Regressão: o caminho da RECEITA sobreviveu à reescrita do despachante
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('39130000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"receita"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  1000.00::numeric,
  'RG1: receita continua de pé depois da reescrita de _metric_leaf');

SELECT is(
  (public.fn_metric_measure('39130000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"num_vendas"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  1::numeric,
  'RG2: num_vendas continua de pé');

-- TODA medida catalogada tem ramo no despachante. É a checagem que a
-- 20260727140000 não fez, e é por não a ter feito que a fatia 8 existiu.
SELECT is_empty(
  $$
  SELECT m.id FROM public.metric_catalog_measures m
   WHERE position('''' || m.id || '''' IN
         (SELECT p.prosrc FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = '_metric_leaf' AND p.pronargs = 8)) = 0
  $$,
  'RG3: nenhuma medida catalogada ficou sem ramo no despachante');

-- ===========================================================================
-- (XO) Isolamento cross-org
-- ===========================================================================
SELECT throws_ok(
  $$SELECT public.fn_metric_measure(
      '39130000-0000-4000-8000-00000000000b',
      '{"kind":"leaf","id":"negocios_na_etapa"}'::jsonb, 'total')$$,
  'P0001', NULL,
  'XO1: membro de A é BLOQUEADO na org B (assert_org_access)');

SELECT set_config('request.jwt.claims',
  '{"sub":"3913115e-0000-4000-8000-00000000000b","role":"authenticated"}', true);

SELECT is(
  (public.fn_metric_measure('39130000-0000-4000-8000-00000000000b',
     '{"kind":"leaf","id":"negocios_na_etapa"}'::jsonb, 'total') ->> 'value')::numeric,
  1::numeric,
  'XO2: org B conta só o próprio negócio — os 3 de A são invisíveis');

SELECT * FROM finish();
ROLLBACK;
