-- supabase/tests/parity_p1_measures_test.sql
--
-- #1292 P1 — as 2 medidas: motor serve ALVO (goals) + leaf reunioes_no_show.
-- Área frágil (motor/meta). ZERO EXECUTE. Crivo bloqueante.
-- Run: supabase db reset && bash supabase/tests/run.sh (branch efêmera).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- ===========================================================================
-- (STRUCT/ZERO-EXECUTE)
-- ===========================================================================
SELECT has_column('public','metric_catalog_measures','goal_type','(STRUCT) goal_type add');
SELECT is((SELECT goal_type FROM public.metric_catalog_measures WHERE id='receita'),
  'faturamento', '(D1) receita → goal_type faturamento (alvo do termômetro)');
SELECT is((SELECT goal_type FROM public.metric_catalog_measures WHERE id='reunioes_marcadas'),
  'reunioes_marcadas', '(D1) reunioes_marcadas → convenção ATUAL, não a legada reunioes (Cais)');
SELECT is((SELECT goal_type FROM public.metric_catalog_measures WHERE id='num_vendas'),
  NULL, '(D1) num_vendas → NULL (vendas é meta de dinheiro, não count)');
SELECT is((SELECT goal_type FROM public.metric_catalog_measures WHERE id='leads_criados'),
  NULL, '(D1) medida sem meta → goal_type null');
SELECT ok(EXISTS(SELECT 1 FROM public.metric_catalog_measures WHERE id='reunioes_no_show'),
  '(D2) medida reunioes_no_show semeada');
SELECT is((SELECT count(*)::int FROM public.metric_catalog_measure_recortes WHERE measure_id='reunioes_no_show'),
  4, '(D2) 4 recortes (total/sdr/origem/tempo)');
-- ZERO EXECUTE: nenhum EXECUTE dinâmico no leaf de no_show.
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname='_metric_leaf_no_show'
            AND prosrc ~* '\yEXECUTE\y'),
  0, '(ZERO-EXEC) _metric_leaf_no_show não tem EXECUTE dinâmico');
-- ACL: leaf interno é service_role-only.
SELECT is(has_function_privilege('authenticated','public._metric_leaf_no_show(uuid,text,tstzrange,text,jsonb)','EXECUTE'),
  false, '(ACL) authenticated NÃO executa _metric_leaf_no_show');
SELECT is(has_function_privilege('service_role','public._metric_leaf_no_show(uuid,text,tstzrange,text,jsonb)','EXECUTE'),
  true, '(ACL) service_role executa');

-- ===========================================================================
-- Fixtures
-- ===========================================================================
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('d1d20000-0000-4000-8000-000000000001', 'QA P1', 'qa-p1', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

-- Meta org-level de faturamento p/ jul/2026 = 100.000.
INSERT INTO public.goals (id, organization_id, name, type, target_value, month, year, team_member_id) VALUES
  ('d1d20000-0000-4000-8000-0000000000a1', 'd1d20000-0000-4000-8000-000000000001', 'Meta jul', 'faturamento', 100000, 7, 2026, NULL)
ON CONFLICT (id) DO NOTHING;

-- meeting_events: 3 booked + 1 held em jul/2026 → no-show = 2.
-- lead_id é NOT NULL; uuid fixo basta (FK off no replica; o leaf faz LEFT JOIN).
INSERT INTO public.meeting_events (id, organization_id, event_type, occurred_at, meeting_date, lead_id, pre_sale_responsible_id) VALUES
  ('d1d20000-0000-4000-8000-0000000000b1','d1d20000-0000-4000-8000-000000000001','meeting_booked','2026-07-05 12:00-03', NULL, 'd1d20000-0000-4000-8000-0000000000e1', NULL),
  ('d1d20000-0000-4000-8000-0000000000b2','d1d20000-0000-4000-8000-000000000001','meeting_booked','2026-07-06 12:00-03', NULL, 'd1d20000-0000-4000-8000-0000000000e1', NULL),
  ('d1d20000-0000-4000-8000-0000000000b3','d1d20000-0000-4000-8000-000000000001','meeting_booked','2026-07-07 12:00-03', NULL, 'd1d20000-0000-4000-8000-0000000000e1', NULL),
  ('d1d20000-0000-4000-8000-0000000000b4','d1d20000-0000-4000-8000-000000000001','meeting_held','2026-07-08 12:00-03','2026-07-08', 'd1d20000-0000-4000-8000-0000000000e1', NULL)
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = DEFAULT;
SET LOCAL role postgres;

-- ===========================================================================
-- (D1) motor estampa target de goals (org+mês corrente)
-- ===========================================================================
SELECT is(
  (public._metric_leaf('d1d20000-0000-4000-8000-000000000001','receita','total','month','2026-07-15',NULL,NULL,'{}'::jsonb) ->> 'target'),
  '100000.00', '(D1) receita.target = goals.target_value do faturamento jul/2026 (100.000)');
SELECT is(
  (public._metric_leaf('d1d20000-0000-4000-8000-000000000001','leads_criados','total','month','2026-07-15',NULL,NULL,'{}'::jsonb) ->> 'target'),
  NULL, '(D1) medida sem goal_type → target null');
-- Mês sem meta → target null (agosto não tem goal).
SELECT is(
  (public._metric_leaf('d1d20000-0000-4000-8000-000000000001','receita','total','month','2026-08-15',NULL,NULL,'{}'::jsonb) ->> 'target'),
  NULL, '(D1) mês sem meta → target null (não inventa)');

-- ===========================================================================
-- (D2) reunioes_no_show = booked − held, clamp ≥ 0
-- ===========================================================================
SELECT is(
  (public._metric_leaf('d1d20000-0000-4000-8000-000000000001','reunioes_no_show','total','month','2026-07-15',NULL,NULL,'{}'::jsonb) ->> 'value'),
  '2', '(D2) no-show total = 3 booked − 1 held = 2');
SELECT is(
  (public._metric_leaf('d1d20000-0000-4000-8000-000000000001','reunioes_marcadas','total','month','2026-07-15',NULL,NULL,'{}'::jsonb) ->> 'value'),
  '3', '(D2 sanity) reunioes_marcadas = 3 booked');
-- Clamp: mês só com held (nenhum booked) → no-show = 0, nunca negativo.
SELECT is(
  (public._metric_leaf('d1d20000-0000-4000-8000-000000000001','reunioes_no_show','total','month','2026-08-15',NULL,NULL,'{}'::jsonb) ->> 'value'),
  '0', '(D2) clamp: janela sem booked → no-show 0, nunca negativo');

SELECT * FROM finish();
ROLLBACK;
