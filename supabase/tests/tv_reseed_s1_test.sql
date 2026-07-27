-- supabase/tests/tv_reseed_s1_test.sql
--
-- #1253 S1 — prova o EXPAND + o RE-SEED cirúrgico da TV. Área frágil (escrita em
-- parede viva). Diagnóstico: Vitral (spec) + Cais (macro). Guardas do §S1:
-- cirúrgico, backup antes, idempotente (2ª = no-op), rollback restaurável.
--
-- Run: supabase db reset && bash supabase/tests/run.sh (na branch efêmera).
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- ===========================================================================
-- (STRUCT) EXPAND: tabelas de catálogo de estilo, colunas novas, format_id intacto
-- ===========================================================================
SELECT has_table('public', 'metric_catalog_widget_styles',  '(STRUCT) widget_styles existe');
SELECT has_table('public', 'metric_catalog_style_variants', '(STRUCT) style_variants existe');
SELECT has_table('public', 'metric_catalog_measure_styles', '(STRUCT) measure_styles existe');
SELECT is((SELECT count(*)::int FROM public.metric_catalog_widget_styles), 7, '(STRUCT) 7 estilos semeados');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE relname = 'metric_catalog_widget_styles'),
  '(STRUCT) RLS habilitada em widget_styles (policy não fica inerte)');
SELECT has_column('public', 'dashboard_widgets', 'value_format',  '(STRUCT) value_format add');
SELECT has_column('public', 'dashboard_widgets', 'widget_style',  '(STRUCT) widget_style add');
SELECT has_column('public', 'dashboard_widgets', 'style_variant', '(STRUCT) style_variant add');
SELECT has_column('public', 'dashboard_widgets', 'accent_hue',    '(STRUCT) accent_hue add');
SELECT has_column('public', 'dashboard_widgets', 'format_id',
  '(STRUCT) format_id INTACTO — o DROP é o S7, não esta fatia');

-- ===========================================================================
-- Fixtures — uma org semeada NO ESTILO ANTIGO (legacy + composable redundante)
-- ===========================================================================
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;   -- fixtures sem triggers/FK ruído

INSERT INTO public.organizations (id, name, slug, timezone, composable_metrics_enabled)
VALUES ('c1a53000-0000-4000-8000-000000000001', 'QA TV S1', 'qa-tv-s1', 'America/Sao_Paulo', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.dashboard_pages (id, organization_id, surface, title, position, rotation_seconds)
VALUES ('c1a53000-0000-4000-8000-0000000000f0', 'c1a53000-0000-4000-8000-000000000001', 'tv', 'Fechamento', 0, 20)
ON CONFLICT (id) DO NOTHING;

-- 2 legacy (célula reservada) + 2 composable redundantes + 1 composable "keeper".
INSERT INTO public.dashboard_widgets
  (organization_id, page_id, measure_kind, renderer_id, weight, pinned, grid_col, grid_row, grid_w, grid_h, position)
VALUES
  ('c1a53000-0000-4000-8000-000000000001','c1a53000-0000-4000-8000-0000000000f0','legacy','legacy:thermometer',        'primary', true, 0,0,3,4,0),
  ('c1a53000-0000-4000-8000-000000000001','c1a53000-0000-4000-8000-0000000000f0','legacy','legacy:closer-performance', 'primary', true, 3,0,4,2,1);
INSERT INTO public.dashboard_widgets
  (organization_id, page_id, measure_kind, measure_id, recorte_id, format_id, value_format, weight, grid_col, grid_row, grid_w, grid_h, position)
VALUES
  ('c1a53000-0000-4000-8000-000000000001','c1a53000-0000-4000-8000-0000000000f0','leaf','receita',   'total', 'currency_brl','currency_brl','primary',7,0,2,1,2),  -- redundante (progress supera)
  ('c1a53000-0000-4000-8000-000000000001','c1a53000-0000-4000-8000-0000000000f0','leaf','receita',   'closer','currency_brl','currency_brl','secondary',3,2,3,2,6), -- redundante (podium supera)
  ('c1a53000-0000-4000-8000-000000000001','c1a53000-0000-4000-8000-0000000000f0','leaf','num_vendas','total', 'integer',     'integer',     'primary',9,0,2,1,3);  -- keeper

SET LOCAL session_replication_role = DEFAULT;
SET LOCAL role postgres;

-- ===========================================================================
-- (PROMOTE) 1ª execução promove
-- ===========================================================================
SELECT is(
  (public._fn_reseed_legacy_to_native_unchecked('c1a53000-0000-4000-8000-000000000001') ->> 'promoted'),
  'true', '(PROMOTE) 1ª execução promove (promoted=true)');

SELECT is((SELECT count(*)::int FROM public.dashboard_widgets
  WHERE organization_id='c1a53000-0000-4000-8000-000000000001' AND measure_kind='legacy'),
  0, '(PROMOTE) nenhuma célula legacy remanescente (§5.0: nada em branco)');

SELECT is((SELECT count(*)::int FROM public.dashboard_widgets
  WHERE organization_id='c1a53000-0000-4000-8000-000000000001'
    AND widget_style='progress' AND style_variant='tube' AND measure_id='receita' AND recorte_id='total'),
  1, '(PROMOTE) thermometer → Progresso.tube (receita/total)');

SELECT is((SELECT count(*)::int FROM public.dashboard_widgets
  WHERE organization_id='c1a53000-0000-4000-8000-000000000001'
    AND widget_style='ranking' AND style_variant='podium' AND measure_id='receita' AND recorte_id='closer'),
  1, '(PROMOTE) closer-performance → Ranking.podium (receita/closer)');

-- DEDUP: os composable antigos (widget_style NULL) que os promovidos superam saíram.
SELECT is((SELECT count(*)::int FROM public.dashboard_widgets
  WHERE organization_id='c1a53000-0000-4000-8000-000000000001'
    AND measure_id='receita' AND recorte_id='closer' AND widget_style IS NULL),
  0, '(DEDUP) bar receita/closer redundante removido');
SELECT is((SELECT count(*)::int FROM public.dashboard_widgets
  WHERE organization_id='c1a53000-0000-4000-8000-000000000001'
    AND measure_id='receita' AND recorte_id='total' AND widget_style IS NULL),
  0, '(DEDUP) número receita/total redundante removido');

-- CIRÚRGICO: o composable NÃO-redundante (num_vendas) fica intocado.
SELECT is((SELECT count(*)::int FROM public.dashboard_widgets
  WHERE organization_id='c1a53000-0000-4000-8000-000000000001' AND measure_id='num_vendas'),
  1, '(CIRÚRGICO) composable não-redundante intocado (num_vendas fica)');

-- ===========================================================================
-- (BACKUP) capturado antes do write, com o estado PRÉ-promoção
-- ===========================================================================
SELECT is((SELECT count(*)::int FROM public.dashboard_composition_backup
  WHERE organization_id='c1a53000-0000-4000-8000-000000000001'),
  1, '(BACKUP) 1 backup capturado');
SELECT ok((SELECT snapshot->'widgets' @> '[{"renderer_id":"legacy:thermometer"}]'::jsonb
  FROM public.dashboard_composition_backup
  WHERE organization_id='c1a53000-0000-4000-8000-000000000001' ORDER BY taken_at DESC LIMIT 1),
  '(BACKUP) snapshot contém o legacy pré-promoção (restaurável)');

-- ===========================================================================
-- (IDEMPOTENTE) 2ª execução = no-op, sem backup novo
-- ===========================================================================
SELECT is(
  (public._fn_reseed_legacy_to_native_unchecked('c1a53000-0000-4000-8000-000000000001') ->> 'promoted'),
  'false', '(IDEMPOTENTE) 2ª execução é no-op (promoted=false)');
SELECT is((SELECT count(*)::int FROM public.dashboard_composition_backup
  WHERE organization_id='c1a53000-0000-4000-8000-000000000001'),
  1, '(IDEMPOTENTE) 2ª execução NÃO duplica backup');

-- ===========================================================================
-- (ACL) a função de promoção é system-only — não vaza a authenticated/anon
-- ===========================================================================
SELECT is(has_function_privilege('authenticated','public._fn_reseed_legacy_to_native_unchecked(uuid)','EXECUTE'),
  false, '(ACL) authenticated NÃO executa a promoção');
SELECT is(has_function_privilege('service_role','public._fn_reseed_legacy_to_native_unchecked(uuid)','EXECUTE'),
  true, '(ACL) service_role executa a promoção');

SELECT * FROM finish();
ROLLBACK;
