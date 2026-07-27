-- ROLLBACK de 20260727110000_tv_widget_style_expand.sql (#1253 S1)
--
-- Reverte o EXPAND: snapshot volta a NÃO emitir os campos de estilo, remove o
-- dual-sync, as 4 colunas novas e as 3 tabelas de catálogo de estilo. format_id
-- fica intocado (nunca foi tocado). Rodar DEPOIS do rollback do 20260727110100
-- (que ainda usa as colunas para restaurar do backup).

-- 1. fn_dashboard_snapshot volta ao corpo anterior (sem widget_style/value_format).
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
           w.grid_col, w.grid_row, w.grid_w, w.grid_h, w.pinned, w.position, w.renderer_id
    FROM public.dashboard_widgets w
    WHERE w.organization_id = p_org_id AND w.page_id = p_page_id
    ORDER BY w.position, w.id
    LIMIT 12
  LOOP
    BEGIN
      IF r.measure_kind = 'legacy' THEN
        v_one := NULL;
      ELSE
        v_ref := CASE r.measure_kind
          WHEN 'ratio' THEN jsonb_build_object('kind','ratio','num',r.num_measure_id,'den',r.den_measure_id)
          ELSE jsonb_build_object('kind','leaf','id',r.measure_id)
        END;
        v_one := public.fn_metric_measure(
                   p_org_id, v_ref, r.recorte_id, p_period, p_ref, p_start, p_end,
                   COALESCE(r.filters, '{}'::jsonb));
      END IF;
      v_widgets := v_widgets || jsonb_build_object(
        'widget_id', r.id, 'measure_kind', r.measure_kind, 'renderer_id', r.renderer_id,
        'weight', r.weight, 'format_id', r.format_id, 'recorte_id', r.recorte_id,
        'eyebrow_override', r.eyebrow_override,
        'grid', jsonb_build_object('col', r.grid_col, 'row', r.grid_row, 'w', r.grid_w, 'h', r.grid_h),
        'pinned', r.pinned, 'filters', COALESCE(r.filters, '{}'::jsonb), 'measure', v_one
      );
    EXCEPTION WHEN OTHERS THEN
      v_widgets := v_widgets || jsonb_build_object('widget_id', r.id, 'error', 'unavailable');
    END;
  END LOOP;
  RETURN jsonb_build_object('disabled', false, 'page_id', p_page_id, 'widgets', v_widgets);
END;
$$;

-- 2. Dual-sync fora.
DROP TRIGGER IF EXISTS trg_aa_dashboard_widgets_value_format_sync ON public.dashboard_widgets;
DROP FUNCTION IF EXISTS public.fn_sync_widget_value_format();

-- 3. Colunas + constraints (antes das tabelas — as colunas têm FK a elas).
ALTER TABLE public.dashboard_widgets DROP CONSTRAINT IF EXISTS dashboard_widgets_style_variant_fk;
ALTER TABLE public.dashboard_widgets DROP CONSTRAINT IF EXISTS dashboard_widgets_style_variant_needs_style;
ALTER TABLE public.dashboard_widgets DROP CONSTRAINT IF EXISTS dashboard_widgets_accent_hue_check;
ALTER TABLE public.dashboard_widgets
  DROP COLUMN IF EXISTS accent_hue,
  DROP COLUMN IF EXISTS style_variant,
  DROP COLUMN IF EXISTS widget_style,
  DROP COLUMN IF EXISTS value_format;

-- 4. Tabelas de catálogo de estilo.
DROP TABLE IF EXISTS public.metric_catalog_measure_styles;
DROP TABLE IF EXISTS public.metric_catalog_style_variants;
DROP TABLE IF EXISTS public.metric_catalog_widget_styles;
