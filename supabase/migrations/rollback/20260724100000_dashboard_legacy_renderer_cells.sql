-- ROLLBACK de 20260724100000_dashboard_legacy_renderer_cells.sql (#1207)
--
-- Ordem de reversão: ANTES do rollback da semeadura (20260724100100), porque o
-- painel semeado pode conter células legadas que dependem deste schema.
--
-- ATENÇÃO — falha DE PROPÓSITO se houver célula legada gravada: devolver o
-- NOT NULL de recorte_id/format_id com linhas legacy no banco deixaria o estado
-- inconsistente em silêncio. Se falhar, apague as células legadas primeiro:
--   DELETE FROM public.dashboard_widgets WHERE measure_kind = 'legacy';

-- ---------------------------------------------------------------------------
-- 1. fn_dashboard_snapshot volta à versão #1194 (sem ramo legacy)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_dashboard_snapshot(
  p_org_id  uuid,
  p_page_id uuid,
  p_period  text  DEFAULT 'month',
  p_ref     date  DEFAULT NULL,
  p_start   date  DEFAULT NULL,
  p_end     date  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_widgets jsonb := '[]'::jsonb;
  v_one jsonb;
  v_ref jsonb;
  r RECORD;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  IF NOT public.fn_composable_metrics_enabled(p_org_id) THEN
    RETURN jsonb_build_object('disabled', true, 'page_id', p_page_id, 'widgets', '[]'::jsonb);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.dashboard_pages dp
                 WHERE dp.id = p_page_id AND dp.organization_id = p_org_id) THEN
    RAISE EXCEPTION 'page % not found for org %', p_page_id, p_org_id USING ERRCODE = 'P0002';
  END IF;

  FOR r IN
    SELECT w.id, w.measure_kind, w.measure_id, w.num_measure_id, w.den_measure_id,
           w.recorte_id, w.format_id, w.filters, w.weight, w.eyebrow_override,
           w.grid_col, w.grid_row, w.grid_w, w.grid_h, w.pinned, w.position
    FROM public.dashboard_widgets w
    WHERE w.organization_id = p_org_id AND w.page_id = p_page_id
    ORDER BY w.position, w.id
    LIMIT 12
  LOOP
    BEGIN
      v_ref := CASE r.measure_kind
        WHEN 'ratio' THEN jsonb_build_object('kind','ratio','num',r.num_measure_id,'den',r.den_measure_id)
        ELSE jsonb_build_object('kind','leaf','id',r.measure_id)
      END;

      v_one := public.fn_metric_measure(
                 p_org_id, v_ref, r.recorte_id, p_period, p_ref, p_start, p_end,
                 COALESCE(r.filters, '{}'::jsonb));

      v_widgets := v_widgets || jsonb_build_object(
        'widget_id', r.id,
        'weight', r.weight,
        'format_id', r.format_id,
        'eyebrow_override', r.eyebrow_override,
        'grid', jsonb_build_object('col', r.grid_col, 'row', r.grid_row, 'w', r.grid_w, 'h', r.grid_h),
        'pinned', r.pinned,
        'measure', v_one
      );
    EXCEPTION WHEN OTHERS THEN
      v_widgets := v_widgets || jsonb_build_object('widget_id', r.id, 'error', 'unavailable');
    END;
  END LOOP;

  RETURN jsonb_build_object('disabled', false, 'page_id', p_page_id, 'widgets', v_widgets);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. fn_metric_catalog volta à versão #1194 (sem 'renderers')
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_metric_catalog()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = 'public'
AS $$
  SELECT jsonb_build_object(
    'measures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'label', m.label, 'unit', m.unit, 'anchor', m.anchor,
        'description', m.description,
        'compatible_recortes', COALESCE((
          SELECT jsonb_agg(mr.recorte_id ORDER BY r.sort)
          FROM public.metric_catalog_measure_recortes mr
          JOIN public.metric_catalog_recortes r ON r.id = mr.recorte_id
          WHERE mr.measure_id = m.id), '[]'::jsonb),
        'compatible_formats', COALESCE((
          SELECT jsonb_agg(mf.format_id ORDER BY f.sort)
          FROM public.metric_catalog_measure_formats mf
          JOIN public.metric_catalog_formats f ON f.id = mf.format_id
          WHERE mf.measure_id = m.id), '[]'::jsonb)
      ) ORDER BY m.sort)
      FROM public.metric_catalog_measures m), '[]'::jsonb),
    'recortes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', r.id, 'label', r.label) ORDER BY r.sort)
      FROM public.metric_catalog_recortes r), '[]'::jsonb),
    'formats', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'label', f.label) ORDER BY f.sort)
      FROM public.metric_catalog_formats f), '[]'::jsonb),
    'ratios', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ra.id, 'label', ra.label,
        'num', ra.num_measure_id, 'den', ra.den_measure_id, 'format', ra.format_id,
        'unit', CASE
          WHEN mn.unit = 'count'    AND md.unit = 'count' THEN 'percent'
          WHEN mn.unit = 'currency' AND md.unit = 'count' THEN 'currency'
          ELSE 'ratio' END
      ) ORDER BY ra.sort)
      FROM public.metric_catalog_ratios ra
      JOIN public.metric_catalog_measures mn ON mn.id = ra.num_measure_id
      JOIN public.metric_catalog_measures md ON md.id = ra.den_measure_id), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Trigger volta à versão #1194 (leaf/ratio, sem ramo legacy)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_widget_against_catalog()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_key text;
  v_hero_count int;
  v_widget_count int;
  v_allowed text[] := ARRAY['pipeline_id','member_id','origin','tag_id','product_id','stream'];
BEGIN
  IF NOT public.fn_composable_metrics_enabled(NEW.organization_id) THEN
    RAISE EXCEPTION 'composable_metrics disabled for org %', NEW.organization_id
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.measure_kind = 'leaf' THEN
    IF NOT EXISTS (SELECT 1 FROM public.metric_catalog_measure_recortes
                   WHERE measure_id = NEW.measure_id AND recorte_id = NEW.recorte_id) THEN
      RAISE EXCEPTION 'recorte % incompatible with measure %', NEW.recorte_id, NEW.measure_id
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.metric_catalog_measure_formats
                   WHERE measure_id = NEW.measure_id AND format_id = NEW.format_id) THEN
      RAISE EXCEPTION 'format % incompatible with measure %', NEW.format_id, NEW.measure_id
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.metric_catalog_measure_recortes
                   WHERE measure_id = NEW.num_measure_id AND recorte_id = NEW.recorte_id) THEN
      RAISE EXCEPTION 'recorte % incompatible with num measure %', NEW.recorte_id, NEW.num_measure_id
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.metric_catalog_measure_recortes
                   WHERE measure_id = NEW.den_measure_id AND recorte_id = NEW.recorte_id) THEN
      RAISE EXCEPTION 'recorte % incompatible with den measure %', NEW.recorte_id, NEW.den_measure_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.filters IS NOT NULL AND jsonb_typeof(NEW.filters) = 'object' THEN
    FOR v_key IN SELECT jsonb_object_keys(NEW.filters) LOOP
      IF v_key = 'organization_id' THEN
        RAISE EXCEPTION 'filters must never contain organization_id' USING ERRCODE = '23514';
      END IF;
      IF NOT (v_key = ANY (v_allowed)) THEN
        RAISE EXCEPTION 'filter key % not in allowlist (%)', v_key, array_to_string(v_allowed, ',')
          USING ERRCODE = '23514';
      END IF;
      IF v_key IN ('pipeline_id','member_id','tag_id','product_id') THEN
        BEGIN
          PERFORM (NEW.filters->>v_key)::uuid;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'filter % must be a uuid', v_key USING ERRCODE = '23514';
        END;
      END IF;
    END LOOP;
  ELSIF NEW.filters IS NOT NULL AND jsonb_typeof(NEW.filters) <> 'object' THEN
    RAISE EXCEPTION 'filters must be a json object' USING ERRCODE = '23514';
  END IF;

  IF NEW.weight = 'hero' THEN
    SELECT count(*) INTO v_hero_count FROM public.dashboard_widgets
    WHERE page_id = NEW.page_id AND weight = 'hero' AND id <> NEW.id;
    IF v_hero_count >= 1 THEN
      RAISE EXCEPTION 'page % already has a hero widget', NEW.page_id USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO v_widget_count FROM public.dashboard_widgets WHERE page_id = NEW.page_id;
    IF v_widget_count >= 12 THEN
      RAISE EXCEPTION 'page % already has 12 widgets (max)', NEW.page_id USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Constraints e colunas
-- ---------------------------------------------------------------------------
ALTER TABLE public.dashboard_widgets DROP CONSTRAINT IF EXISTS dashboard_widgets_kind_coherence;
ALTER TABLE public.dashboard_widgets
  ADD CONSTRAINT dashboard_widgets_kind_coherence CHECK (
    CASE measure_kind
      WHEN 'leaf'  THEN measure_id IS NOT NULL AND num_measure_id IS NULL AND den_measure_id IS NULL
      WHEN 'ratio' THEN measure_id IS NULL AND num_measure_id IS NOT NULL AND den_measure_id IS NOT NULL
      ELSE false
    END
  );

ALTER TABLE public.dashboard_widgets DROP CONSTRAINT IF EXISTS dashboard_widgets_measure_kind_check;
ALTER TABLE public.dashboard_widgets
  ADD CONSTRAINT dashboard_widgets_measure_kind_check
  CHECK (measure_kind IN ('leaf','ratio'));

ALTER TABLE public.dashboard_widgets DROP COLUMN IF EXISTS renderer_id;

-- Falha de propósito se ainda houver linha sem recorte/formato (célula legada).
ALTER TABLE public.dashboard_widgets ALTER COLUMN recorte_id SET NOT NULL;
ALTER TABLE public.dashboard_widgets ALTER COLUMN format_id  SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Catálogo de renderers
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.metric_catalog_renderers CASCADE;
