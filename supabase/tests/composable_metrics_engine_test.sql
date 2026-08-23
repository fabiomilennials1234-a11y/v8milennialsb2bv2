-- supabase/tests/composable_metrics_engine_test.sql
--
-- ISSUE #1194 (PRD #986 · ADR-0023) — pgTAP da fundação das Métricas Montáveis
-- (Camada 2): catálogo fechado, motor fn_metric_measure, esquema de composição,
-- fn_dashboard_snapshot, publish atômico.
--
-- Cobre os invariantes obrigatórios do brief:
--   (ZE) ZERO EXECUTE sobre prosrc do motor (1º mandamento do CTO).
--   (XO) isolamento cross-org (assert_org_access bloqueia org alheia).
--   (RJ) rejeição de config inválida na ESCRITA (FK + CHECK + trigger).
--   (D0) razão den=0 → null (não 0, não erro).
--   (DN) deny-all de escrita no catálogo.
--   + catálogo servido, leitura de medidas, snapshot com gate de flag, publish.
--
-- Run: supabase start && supabase db reset && bash supabase/tests/run.sh
-- Roda inteiro em transação revertida — não muta o banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

-- ===========================================================================
-- Fixtures (postgres + replica: triggers OFF, âncoras temporais controladas)
-- ===========================================================================
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('11940000-0000-4000-8000-00000000000a', 'Org A 1194', 'org-a-1194', 'America/Sao_Paulo'),
  ('11940000-0000-4000-8000-00000000000b', 'Org B 1194', 'org-b-1194', 'America/Sao_Paulo'),
  ('11940000-0000-4000-8000-00000000000c', 'Org C 1194', 'org-c-1194', 'America/Sao_Paulo')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

-- Flag: A ligada, C desligada (default), B irrelevante (cross-org).
UPDATE public.organizations SET composable_metrics_enabled = true
  WHERE id = '11940000-0000-4000-8000-00000000000a';

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('11940000-0000-4000-8000-000000000101', 'user-1194@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', ''),
  ('11940000-0000-4000-8000-000000000102', 'user2-1194@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- user 101 é admin de A e de C. user 102 é MEMBRO não-admin de A (gate de publish).
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('11940000-0000-4000-8000-000000000201', '11940000-0000-4000-8000-00000000000a',
   '11940000-0000-4000-8000-000000000101', 'Closer A1', 'admin', true),
  ('11940000-0000-4000-8000-000000000202', '11940000-0000-4000-8000-00000000000a',
   NULL, 'Closer A2', 'member', true),
  ('11940000-0000-4000-8000-000000000203', '11940000-0000-4000-8000-00000000000c',
   '11940000-0000-4000-8000-000000000101', 'Admin C', 'admin', true),
  ('11940000-0000-4000-8000-000000000204', '11940000-0000-4000-8000-00000000000a',
   '11940000-0000-4000-8000-000000000102', 'Membro A3', 'member', true)
ON CONFLICT (id) DO NOTHING;

-- 3 leads criados em AGO/2027 (leads_criados=3). origem 2 meta_ads + 1 site.
INSERT INTO public.leads (id, organization_id, name, origin, created_at) VALUES
  ('11940000-0000-4000-8000-000000000301', '11940000-0000-4000-8000-00000000000a', 'Lead 1', 'meta_ads', '2027-08-05 12:00:00-03'),
  ('11940000-0000-4000-8000-000000000302', '11940000-0000-4000-8000-00000000000a', 'Lead 2', 'meta_ads', '2027-08-12 12:00:00-03'),
  ('11940000-0000-4000-8000-000000000303', '11940000-0000-4000-8000-00000000000a', 'Lead 3', 'site',     '2027-08-18 12:00:00-03')
ON CONFLICT (id) DO NOTHING;

-- Vendas AGO/2027: sale 1000 (novo_negocio) + sale 3000 (carteira) = 4000 líquido.
-- + par estornado 5000 (não conta). num_vendas=2 líquido. closer = A1.
INSERT INTO public.sale_events
  (id, organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at, sale_value, currency, revenue_stream, sale_responsible_id, source, producer) VALUES
  ('11940000-0000-4000-8000-000000000701', '11940000-0000-4000-8000-00000000000a', '11940000-0000-4000-8000-000000000301',
   '11940000-0000-4000-8000-000000000401', 'vendido', 'sale', '2027-08-10 12:00:00-03', 1000, 'BRL', 'novo_negocio',
   '11940000-0000-4000-8000-000000000201', 'backfill', 'funnel'),
  ('11940000-0000-4000-8000-000000000702', '11940000-0000-4000-8000-00000000000a', '11940000-0000-4000-8000-000000000302',
   '11940000-0000-4000-8000-000000000401', 'vendido', 'sale', '2027-08-20 12:00:00-03', 3000, 'BRL', 'carteira',
   '11940000-0000-4000-8000-000000000201', 'backfill', 'funnel'),
  ('11940000-0000-4000-8000-000000000703', '11940000-0000-4000-8000-00000000000a', '11940000-0000-4000-8000-000000000303',
   '11940000-0000-4000-8000-000000000401', 'vendido', 'sale', '2027-08-22 12:00:00-03', 5000, 'BRL', 'novo_negocio',
   '11940000-0000-4000-8000-000000000201', 'backfill', 'funnel')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.sale_events
  (id, organization_id, lead_id, pipeline_id, stage_key, event_type, reversed_event_id, sold_at, sale_value, currency, revenue_stream, source, producer) VALUES
  ('11940000-0000-4000-8000-000000000704', '11940000-0000-4000-8000-00000000000a', '11940000-0000-4000-8000-000000000303',
   '11940000-0000-4000-8000-000000000401', 'vendido', 'sale_reversed', '11940000-0000-4000-8000-000000000703',
   '2027-08-23 12:00:00-03', 5000, 'BRL', 'novo_negocio', 'backfill', 'funnel')
ON CONFLICT (id) DO NOTHING;

-- Reuniões AGO/2027: 2 booked, 1 held.
INSERT INTO public.meeting_events (id, organization_id, lead_id, event_type, occurred_at, meeting_date, pre_sale_responsible_id) VALUES
  ('11940000-0000-4000-8000-000000000801', '11940000-0000-4000-8000-00000000000a', '11940000-0000-4000-8000-000000000301', 'meeting_booked', '2027-08-06 12:00:00-03', NULL, '11940000-0000-4000-8000-000000000202'),
  ('11940000-0000-4000-8000-000000000802', '11940000-0000-4000-8000-00000000000a', '11940000-0000-4000-8000-000000000302', 'meeting_booked', '2027-08-09 12:00:00-03', NULL, '11940000-0000-4000-8000-000000000202'),
  ('11940000-0000-4000-8000-000000000803', '11940000-0000-4000-8000-00000000000a', '11940000-0000-4000-8000-000000000301', 'meeting_held',   '2027-08-11 12:00:00-03', '2027-08-11 15:00:00-03', '11940000-0000-4000-8000-000000000202')
ON CONFLICT (id) DO NOTHING;

-- Entradas abertas (leads_na_etapa): 2 em 'novo', 1 em 'contato'.
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, closed_at, entered_at) VALUES
  ('11940000-0000-4000-8000-000000000901', '11940000-0000-4000-8000-00000000000a', '11940000-0000-4000-8000-000000000401', '11940000-0000-4000-8000-000000000301', 'novo',    NULL, now()),
  ('11940000-0000-4000-8000-000000000902', '11940000-0000-4000-8000-00000000000a', '11940000-0000-4000-8000-000000000401', '11940000-0000-4000-8000-000000000302', 'novo',    NULL, now()),
  ('11940000-0000-4000-8000-000000000903', '11940000-0000-4000-8000-00000000000a', '11940000-0000-4000-8000-000000000401', '11940000-0000-4000-8000-000000000303', 'contato', NULL, now())
ON CONFLICT DO NOTHING;

-- Transições (tempo_medio_etapa).
INSERT INTO public.pipeline_stage_events (id, organization_id, lead_id, pipeline_id, from_stage_key, to_stage_key, occurred_at) VALUES
  ('11940000-0000-4000-8000-000000000a01', '11940000-0000-4000-8000-00000000000a', '11940000-0000-4000-8000-000000000301', '11940000-0000-4000-8000-000000000401', NULL, 'novo', now() - interval '2 days'),
  ('11940000-0000-4000-8000-000000000a02', '11940000-0000-4000-8000-00000000000a', '11940000-0000-4000-8000-000000000303', '11940000-0000-4000-8000-000000000401', 'novo', 'contato', now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- Página + widget PUBLICADO em A (seed via replica → trigger off; widget é válido).
INSERT INTO public.dashboard_pages (id, organization_id, surface, title, position) VALUES
  ('11940000-0000-4000-8000-000000000501', '11940000-0000-4000-8000-00000000000a', 'tv', 'TV A', 0),
  ('11940000-0000-4000-8000-000000000502', '11940000-0000-4000-8000-00000000000c', 'tv', 'TV C', 0),
  ('11940000-0000-4000-8000-000000000503', '11940000-0000-4000-8000-00000000000a', 'tv', 'TV A cheia', 1)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.dashboard_widgets (id, organization_id, page_id, weight, measure_kind, measure_id, recorte_id, format_id) VALUES
  ('11940000-0000-4000-8000-000000000601', '11940000-0000-4000-8000-00000000000a', '11940000-0000-4000-8000-000000000501',
   'hero', 'leaf', 'receita', 'total', 'currency_brl')
ON CONFLICT (id) DO NOTHING;
-- Página 503 já com 12 widgets (teto): o 13º deve ser rejeitado (23514).
INSERT INTO public.dashboard_widgets (organization_id, page_id, weight, measure_kind, measure_id, recorte_id, format_id, position)
SELECT '11940000-0000-4000-8000-00000000000a', '11940000-0000-4000-8000-000000000503',
       'secondary', 'leaf', 'num_vendas', 'total', 'integer', g
FROM generate_series(1, 12) g;

-- ===========================================================================
-- (a) Estrutura + grants
-- ===========================================================================
SELECT has_function('public', 'fn_metric_catalog', ARRAY[]::text[], '(a) fn_metric_catalog existe');
SELECT has_function('public', 'fn_metric_measure', ARRAY['uuid','jsonb','text','text','date','date','date','jsonb'], '(a) fn_metric_measure existe');
SELECT has_function('public', 'fn_dashboard_snapshot', ARRAY['uuid','uuid','text','date','date','date'], '(a) fn_dashboard_snapshot existe');
SELECT has_function('public', 'fn_publish_dashboard_page', ARRAY['uuid','uuid'], '(a) fn_publish_dashboard_page existe');
SELECT ok(has_function_privilege('authenticated', 'public.fn_metric_measure(uuid,jsonb,text,text,date,date,date,jsonb)', 'EXECUTE'),
  '(a) authenticated executa fn_metric_measure');

-- ===========================================================================
-- (ZE) INVARIANTE ZERO EXECUTE — nenhuma função do motor usa EXECUTE/format()
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('fn_metric_measure','_metric_leaf','_metric_leaf_sales',
       '_metric_leaf_leads_criados','_metric_leaf_meetings','_metric_leaf_stage_snapshot',
       '_metric_leaf_stage_duration','fn_dashboard_snapshot')
     AND (p.prosrc ~* '\yexecute\y' OR p.prosrc ~* 'format\s*\(')),
  0, '(ZE) motor não contém EXECUTE nem format()-into-query em prosrc');

SELECT ok(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname LIKE '\_metric\_leaf%') >= 6,
  '(ZE) leaves do motor existem (sanidade do escopo do grep)');

-- ===========================================================================
-- (DN) deny-all de escrita no catálogo
-- ===========================================================================
-- O número exato era 7 quando o motor nasceu. O SCRUM-311 está portando 19
-- medidas legadas, uma migration por vez, então qualquer literal aqui quebra na
-- próxima fatia — e um teste que reprova por trabalho planejado ensina a
-- ignorar o teste. O que importa não é a contagem: é que o catálogo servido
-- pela função seja EXATAMENTE o catálogo registrado na tabela, e que as sete
-- fundadoras continuem lá.
SELECT is(
  (SELECT count(*)::int FROM (SELECT jsonb_array_elements(public.fn_metric_catalog()->'measures')) x),
  (SELECT count(*)::int FROM public.metric_catalog_measures),
  '(cat) fn_metric_catalog serve todas as medidas registradas, nem uma a mais nem a menos');

SELECT is(
  (SELECT count(*)::int FROM public.metric_catalog_measures
    WHERE id IN ('receita','num_vendas','leads_criados','reunioes_marcadas',
                 'reunioes_realizadas','leads_na_etapa','tempo_medio_etapa')),
  7, '(cat) as sete medidas fundadoras continuam no catálogo');
-- Mesmo tratamento das medidas, e pela mesma razão. Esta linha ficou literal em
-- 3 enquanto a de cima já era à prova de futuro — e a primeira razão nova
-- (`taxa_qualidade`, 20270812100001) a reprovaria sem que nada estivesse
-- errado. O que importa é a identidade função↔tabela e a sobrevivência das três
-- fundadoras.
SELECT is(
  (SELECT count(*)::int FROM (SELECT jsonb_array_elements(public.fn_metric_catalog()->'ratios')) x),
  (SELECT count(*)::int FROM public.metric_catalog_ratios),
  '(cat) fn_metric_catalog serve todas as razões registradas, nem uma a mais nem a menos');

SELECT is(
  (SELECT count(*)::int FROM public.metric_catalog_ratios
    WHERE id IN ('conversao','comparecimento','ticket_medio')),
  3, '(cat) os três presets fundadores de razão continuam no catálogo');

-- RLS HABILITADA em TODA tabela nova (fecha a classe do bug do ratios: o
-- deny-all via REVOKE passa mesmo com RLS off, então checa-se relrowsecurity
-- direto, não só o comportamento de escrita).
SELECT is(
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relrowsecurity = true
     AND c.relname IN ('metric_catalog_measures','metric_catalog_recortes','metric_catalog_formats',
       'metric_catalog_measure_recortes','metric_catalog_measure_formats','metric_catalog_ratios',
       'dashboard_pages','dashboard_widgets')),
  8, '(DN) RLS habilitada nas 6 tabelas de catálogo + 2 de composição (sem policy inerte)');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'metric_catalog_ratios'),
  '(DN) metric_catalog_ratios tem RLS habilitada (regressão do achado do Crivo)');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11940000-0000-4000-8000-000000000101","role":"authenticated"}', true);

SELECT throws_ok(
  $$ INSERT INTO public.metric_catalog_measures (id,label,unit,anchor) VALUES ('hack','x','count','hoje') $$,
  NULL, NULL, '(DN) authenticated NÃO escreve no catálogo (deny-all)');

-- ===========================================================================
-- Leitura de medidas (authenticated, membro de A)
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('11940000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"receita"}'::jsonb, 'total', 'month', '2027-08-15') ->> 'value')::numeric,
  4000::numeric, '(m) receita total AGO = 4000 (líquido de estorno)');

SELECT is(
  (public.fn_metric_measure('11940000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"num_vendas"}'::jsonb, 'total', 'month', '2027-08-15') ->> 'value')::numeric,
  2::numeric, '(m) num_vendas total AGO = 2');

SELECT is(
  (public.fn_metric_measure('11940000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"leads_criados"}'::jsonb, 'total', 'month', '2027-08-15') ->> 'value')::numeric,
  3::numeric, '(m) leads_criados total AGO = 3');

SELECT is(
  (public.fn_metric_measure('11940000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"reunioes_marcadas"}'::jsonb, 'total', 'month', '2027-08-15') ->> 'value')::numeric,
  2::numeric, '(m) reunioes_marcadas AGO = 2');

SELECT is(
  (public.fn_metric_measure('11940000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"reunioes_realizadas"}'::jsonb, 'total', 'month', '2027-08-15') ->> 'value')::numeric,
  1::numeric, '(m) reunioes_realizadas AGO = 1');

SELECT is(
  (public.fn_metric_measure('11940000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"leads_na_etapa"}'::jsonb, 'total', 'month', '2027-08-15') ->> 'value')::numeric,
  3::numeric, '(m) leads_na_etapa total (snapshot) = 3');

-- recorte com quebra (closer) → série, unidade currency
SELECT is(
  public.fn_metric_measure('11940000-0000-4000-8000-00000000000a',
    '{"kind":"leaf","id":"receita"}'::jsonb, 'closer', 'month', '2027-08-15') ->> 'unit',
  'currency', '(m) receita.unit = currency');
SELECT ok(
  jsonb_typeof(public.fn_metric_measure('11940000-0000-4000-8000-00000000000a',
    '{"kind":"leaf","id":"receita"}'::jsonb, 'closer', 'month', '2027-08-15') -> 'series') = 'array',
  '(m) recorte closer devolve série (array)');

-- recorte stream: a soma da série bate o total (4000)
SELECT is(
  (SELECT COALESCE(SUM((e->>'value')::numeric),0)
   FROM jsonb_array_elements(
     public.fn_metric_measure('11940000-0000-4000-8000-00000000000a',
       '{"kind":"leaf","id":"receita"}'::jsonb, 'stream', 'month', '2027-08-15') -> 'series') e),
  4000::numeric, '(m) série por stream soma ao total');

-- ===========================================================================
-- (RATIO) conversão + (D0) den=0 → null
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('11940000-0000-4000-8000-00000000000a',
     '{"kind":"ratio","num":"num_vendas","den":"leads_criados"}'::jsonb, 'total', 'month', '2027-08-15') ->> 'value')::numeric,
  66.67::numeric, '(ratio) conversão AGO = 2/3 = 66.67%');
SELECT is(
  public.fn_metric_measure('11940000-0000-4000-8000-00000000000a',
    '{"kind":"ratio","num":"num_vendas","den":"leads_criados"}'::jsonb, 'total', 'month', '2027-08-15') ->> 'unit',
  'percent', '(ratio) unit count/count → percent');
SELECT ok(
  (public.fn_metric_measure('11940000-0000-4000-8000-00000000000a',
    '{"kind":"ratio","num":"num_vendas","den":"leads_criados"}'::jsonb, 'total', 'month', '2027-01-15') -> 'value') = 'null'::jsonb,
  '(D0) den=0 (JAN sem leads) → value null (não 0, não erro)');
SELECT is(
  public.fn_metric_measure('11940000-0000-4000-8000-00000000000a',
    '{"kind":"ratio","num":"receita","den":"num_vendas"}'::jsonb, 'total', 'month', '2027-08-15') ->> 'unit',
  'currency', '(ratio) unit currency/count → currency (ticket médio)');

-- ===========================================================================
-- (XO) isolamento cross-org
-- ===========================================================================
SELECT lives_ok(
  $$ SELECT public.fn_metric_measure('11940000-0000-4000-8000-00000000000a','{"kind":"leaf","id":"receita"}'::jsonb,'total','month','2027-08-15') $$,
  '(XO) membro de A lê a própria org');
SELECT throws_ok(
  $$ SELECT public.fn_metric_measure('11940000-0000-4000-8000-00000000000b','{"kind":"leaf","id":"receita"}'::jsonb,'total','month','2027-08-15') $$,
  'P0001', NULL, '(XO) membro de A é BLOQUEADO na org B (assert_org_access)');
SELECT throws_ok(
  $$ SELECT public.fn_dashboard_snapshot('11940000-0000-4000-8000-00000000000b','11940000-0000-4000-8000-000000000501','month','2027-08-15') $$,
  'P0001', NULL, '(XO) snapshot cross-org bloqueado');

-- ===========================================================================
-- (SNAP) snapshot: A (flag ON) devolve widget; C (flag OFF) devolve disabled
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM jsonb_array_elements(
     public.fn_dashboard_snapshot('11940000-0000-4000-8000-00000000000a','11940000-0000-4000-8000-000000000501','month','2027-08-15') -> 'widgets')),
  1, '(SNAP) página A devolve 1 widget publicado');
SELECT is(
  (public.fn_dashboard_snapshot('11940000-0000-4000-8000-00000000000a','11940000-0000-4000-8000-000000000501','month','2027-08-15')
     #> '{widgets,0,measure}' ->> 'value')::numeric,
  4000::numeric, '(SNAP) widget hero (receita/total) rende 4000');
SELECT is(
  (public.fn_dashboard_snapshot('11940000-0000-4000-8000-00000000000c','11940000-0000-4000-8000-000000000502','month','2027-08-15') ->> 'disabled')::boolean,
  true, '(SNAP) org C com flag OFF → disabled true');

-- ===========================================================================
-- (RJ) rejeição de config inválida na ESCRITA — triggers LIGADOS
-- ===========================================================================
-- session_replication_role só o superusuário troca → volta a postgres, reabilita
-- triggers, e retoma como authenticated admin de A.
SET LOCAL role postgres;
SET LOCAL session_replication_role = DEFAULT;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11940000-0000-4000-8000-000000000101","role":"authenticated"}', true);

-- FK backstop: as colunas de catálogo de dashboard_widgets são ancoradas por FK
-- (measure_id, num_measure_id, den_measure_id → measures; recorte_id; format_id).
--
-- HERDADO, corrigido aqui: a asserção contava 5 e o schema tem 6 desde
-- `20260727110000_tv_widget_style_expand`, que acrescentou
-- `dashboard_widgets_value_format_fkey → metric_catalog_formats`. O teste
-- reprovava por uma FK A MAIS — isto é, por schema mais protegido do que o
-- esperado. Contar FK envelhece a cada coluna nova; o que importa é que estas
-- cinco colunas continuem ancoradas, então a asserção passa a ser por NOME.
SELECT is(
  (SELECT count(*)::int FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'dashboard_widgets' AND c.contype = 'f'
     AND c.conname IN (
       'dashboard_widgets_measure_id_fkey',
       'dashboard_widgets_num_measure_id_fkey',
       'dashboard_widgets_den_measure_id_fkey',
       'dashboard_widgets_recorte_id_fkey',
       'dashboard_widgets_format_id_fkey')),
  5, '(RJ) as 5 colunas de catálogo de dashboard_widgets seguem ancoradas por FK');

-- measure inexistente: o trigger BEFORE front-runs a FK → 23514 (rejeitado na escrita).
SELECT throws_ok(
  $$ INSERT INTO public.dashboard_widgets (organization_id,page_id,measure_kind,measure_id,recorte_id,format_id)
     VALUES ('11940000-0000-4000-8000-00000000000a','11940000-0000-4000-8000-000000000501','leaf','NAO_EXISTE','total','integer') $$,
  '23514', NULL, '(RJ) measure fora do catálogo rejeitado na escrita');

-- trigger: recorte incompatível (receita não faz etapa)
SELECT throws_ok(
  $$ INSERT INTO public.dashboard_widgets (organization_id,page_id,measure_kind,measure_id,recorte_id,format_id)
     VALUES ('11940000-0000-4000-8000-00000000000a','11940000-0000-4000-8000-000000000501','leaf','receita','etapa','currency_brl') $$,
  '23514', NULL, '(RJ) recorte incompatível rejeitado pelo trigger');

-- trigger: filtro com organization_id proibido
SELECT throws_ok(
  $$ INSERT INTO public.dashboard_widgets (organization_id,page_id,measure_kind,measure_id,recorte_id,format_id,filters)
     VALUES ('11940000-0000-4000-8000-00000000000a','11940000-0000-4000-8000-000000000501','leaf','receita','total','currency_brl','{"organization_id":"x"}') $$,
  '23514', NULL, '(RJ) filtro com organization_id rejeitado');

-- trigger: chave de filtro fora da allowlist
SELECT throws_ok(
  $$ INSERT INTO public.dashboard_widgets (organization_id,page_id,measure_kind,measure_id,recorte_id,format_id,filters)
     VALUES ('11940000-0000-4000-8000-00000000000a','11940000-0000-4000-8000-000000000501','leaf','receita','total','currency_brl','{"lead_id":"x"}') $$,
  '23514', NULL, '(RJ) chave de filtro fora da allowlist rejeitada');

-- CHECK: eyebrow > 28
SELECT throws_ok(
  $$ INSERT INTO public.dashboard_widgets (organization_id,page_id,measure_kind,measure_id,recorte_id,format_id,eyebrow_override)
     VALUES ('11940000-0000-4000-8000-00000000000a','11940000-0000-4000-8000-000000000501','leaf','receita','total','currency_brl','uma legenda com muito mais de vinte e oito caracteres') $$,
  '23514', NULL, '(RJ) eyebrow_override > 28 rejeitado por CHECK');

-- flag OFF: escrita de widget em C bloqueada (user é admin de C)
SELECT throws_ok(
  $$ INSERT INTO public.dashboard_widgets (organization_id,page_id,measure_kind,measure_id,recorte_id,format_id)
     VALUES ('11940000-0000-4000-8000-00000000000c','11940000-0000-4000-8000-000000000502','leaf','receita','total','currency_brl') $$,
  'P0001', NULL, '(RJ) org C flag OFF → escrita de composição bloqueada');

-- máx 1 hero/página: página 501 já tem o hero 601 → 2º hero rejeitado.
SELECT throws_ok(
  $$ INSERT INTO public.dashboard_widgets (organization_id,page_id,weight,measure_kind,measure_id,recorte_id,format_id)
     VALUES ('11940000-0000-4000-8000-00000000000a','11940000-0000-4000-8000-000000000501','hero','leaf','num_vendas','total','integer') $$,
  '23514', NULL, '(RJ) 2º hero na página rejeitado (máx 1 hero)');

-- teto 12 widgets/página: página 503 já tem 12 → o 13º rejeitado.
SELECT throws_ok(
  $$ INSERT INTO public.dashboard_widgets (organization_id,page_id,measure_kind,measure_id,recorte_id,format_id)
     VALUES ('11940000-0000-4000-8000-00000000000a','11940000-0000-4000-8000-000000000503','leaf','num_vendas','total','integer') $$,
  '23514', NULL, '(RJ) 13º widget na página rejeitado (teto 12)');

-- ===========================================================================
-- (PUB) publish atômico
-- ===========================================================================
-- membro NÃO-admin de A não publica (gate admin-only, 42501).
SELECT set_config('request.jwt.claims',
  '{"sub":"11940000-0000-4000-8000-000000000102","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.fn_publish_dashboard_page('11940000-0000-4000-8000-00000000000a','11940000-0000-4000-8000-000000000501') $$,
  '42501', NULL, '(PUB) membro não-admin é bloqueado no publish (admin-only)');

SET LOCAL role postgres;
UPDATE public.dashboard_pages
  SET draft = '{"widgets":[{"measure_kind":"leaf","measure_id":"num_vendas","recorte_id":"total","format_id":"integer","weight":"primary"}]}'::jsonb
  WHERE id = '11940000-0000-4000-8000-000000000501';
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11940000-0000-4000-8000-000000000101","role":"authenticated"}', true);

SELECT is(
  (public.fn_publish_dashboard_page('11940000-0000-4000-8000-00000000000a','11940000-0000-4000-8000-000000000501') ->> 'published')::int,
  1, '(PUB) publish promove 1 widget do draft');
SELECT is(
  (SELECT count(*)::int FROM public.dashboard_widgets WHERE page_id='11940000-0000-4000-8000-000000000501'),
  1, '(PUB) página tem exatamente o widget publicado (swap trocou o hero anterior)');
SELECT is(
  (SELECT measure_id FROM public.dashboard_widgets WHERE page_id='11940000-0000-4000-8000-000000000501'),
  'num_vendas', '(PUB) widget publicado é o do draft (num_vendas)');

-- publish de draft inválido reverte (não deixa a página vazia)
SET LOCAL role postgres;
UPDATE public.dashboard_pages
  SET draft = '{"widgets":[{"measure_kind":"leaf","measure_id":"receita","recorte_id":"etapa","format_id":"currency_brl"}]}'::jsonb
  WHERE id = '11940000-0000-4000-8000-000000000501';
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11940000-0000-4000-8000-000000000101","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.fn_publish_dashboard_page('11940000-0000-4000-8000-00000000000a','11940000-0000-4000-8000-000000000501') $$,
  '23514', NULL, '(PUB) draft inválido (recorte incompatível) falha o publish');
SELECT is(
  (SELECT count(*)::int FROM public.dashboard_widgets WHERE page_id='11940000-0000-4000-8000-000000000501'),
  1, '(PUB) publish falho reverte — página mantém o widget anterior (atômico)');

SET LOCAL role postgres;

SELECT * FROM finish();
ROLLBACK;
