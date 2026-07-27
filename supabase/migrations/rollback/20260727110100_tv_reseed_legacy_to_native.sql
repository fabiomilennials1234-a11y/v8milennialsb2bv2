-- ROLLBACK de 20260727110100_tv_reseed_legacy_to_native.sql (#1253 S1)
--
-- Restaura a composição de cada org a partir do BACKUP mais recente (o dump feito
-- antes da promoção), reverte a semeadura para a versão legada e remove a tabela
-- de backup. Rodar ANTES do rollback do 20260727110000 (as colunas de estilo
-- ainda precisam existir para o restore).

-- 1. Restaura pages+widgets do backup mais recente por org (desfaz promoção+dedup).
DO $rb$
DECLARE
  r RECORD;
  v_snap jsonb;
BEGIN
  FOR r IN
    SELECT DISTINCT organization_id
    FROM public.dashboard_composition_backup
    WHERE reason = '#1253 S1 re-seed legacy→native'
  LOOP
    SELECT snapshot INTO v_snap
    FROM public.dashboard_composition_backup
    WHERE organization_id = r.organization_id AND reason = '#1253 S1 re-seed legacy→native'
    ORDER BY taken_at DESC LIMIT 1;

    -- Zera a composição TV atual da org (cascade apaga os widgets) e re-cria do dump.
    DELETE FROM public.dashboard_pages WHERE organization_id = r.organization_id AND surface = 'tv';

    INSERT INTO public.dashboard_pages
      (id, organization_id, surface, title, position, rotation_seconds, draft, created_by, created_at, updated_at)
    SELECT (p->>'id')::uuid, r.organization_id, p->>'surface', p->>'title',
           (p->>'position')::int, (p->>'rotation_seconds')::int, p->'draft',
           NULLIF(p->>'created_by','')::uuid, (p->>'created_at')::timestamptz, (p->>'updated_at')::timestamptz
    FROM jsonb_array_elements(v_snap->'pages') p
    WHERE p->>'surface' = 'tv';

    -- Widgets restaurados com os ids/posições originais. value_format é re-sincado
    -- pelo trigger; widget_style/style_variant voltam nulos (estado pré-promoção).
    INSERT INTO public.dashboard_widgets
      (id, organization_id, page_id, grid_col, grid_row, grid_w, grid_h, weight,
       measure_kind, measure_id, num_measure_id, den_measure_id, recorte_id, format_id,
       filters, eyebrow_override, pinned, position, renderer_id, created_at, updated_at)
    SELECT (w->>'id')::uuid, r.organization_id, (w->>'page_id')::uuid,
           (w->>'grid_col')::int, (w->>'grid_row')::int, (w->>'grid_w')::int, (w->>'grid_h')::int,
           w->>'weight', w->>'measure_kind', w->>'measure_id', w->>'num_measure_id', w->>'den_measure_id',
           w->>'recorte_id', w->>'format_id', COALESCE(w->'filters','{}'::jsonb),
           w->>'eyebrow_override', (w->>'pinned')::boolean, (w->>'position')::int,
           w->>'renderer_id', (w->>'created_at')::timestamptz, (w->>'updated_at')::timestamptz
    FROM jsonb_array_elements(v_snap->'widgets') w
    WHERE (w->>'page_id')::uuid IN (
      SELECT (p->>'id')::uuid FROM jsonb_array_elements(v_snap->'pages') p WHERE p->>'surface' = 'tv'
    );
  END LOOP;
END
$rb$;

-- 2. Reverte a semeadura para a versão legada (#1207): os 2 congelados voltam a
--    ser célula reservada, e receita/total + receita/closer bar voltam à parede.
CREATE OR REPLACE FUNCTION public._fn_seed_default_dashboard_unchecked(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE v_page1 uuid; v_page2 uuid; v_created int := 0;
BEGIN
  IF NOT public.fn_composable_metrics_enabled(p_org_id) THEN
    RETURN jsonb_build_object('seeded', false, 'reason', 'flag_off');
  END IF;
  IF EXISTS (SELECT 1 FROM public.dashboard_pages WHERE organization_id = p_org_id AND surface = 'tv') THEN
    RETURN jsonb_build_object('seeded', false, 'reason', 'already_exists');
  END IF;

  INSERT INTO public.dashboard_pages (organization_id, surface, title, position, rotation_seconds)
  VALUES (p_org_id, 'tv', 'Fechamento', 0, 20) RETURNING id INTO v_page1;
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, renderer_id, weight, pinned, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page1, 'legacy', 'legacy:thermometer',        'primary', true, 0, 0, 3, 4, 0),
    (p_org_id, v_page1, 'legacy', 'legacy:closer-performance', 'primary', true, 3, 0, 4, 2, 1);
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page1, 'leaf', 'receita',    'total', 'currency_brl', 'primary', 7, 0, 2, 1, 2),
    (p_org_id, v_page1, 'leaf', 'num_vendas', 'total', 'integer',      'primary', 9, 0, 2, 1, 3);
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, num_measure_id, den_measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page1, 'ratio', 'num_vendas', 'leads_criados', 'total', 'percent_1',    'primary', 7, 1, 2, 1, 4),
    (p_org_id, v_page1, 'ratio', 'receita',    'num_vendas',    'total', 'currency_brl', 'primary', 9, 1, 2, 1, 5);
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page1, 'leaf', 'receita',        'closer', 'currency_brl', 'secondary', 3, 2, 3, 2, 6),
    (p_org_id, v_page1, 'leaf', 'leads_na_etapa', 'etapa',  'integer',      'secondary', 7, 2, 5, 3, 7);
  v_created := v_created + 8;

  INSERT INTO public.dashboard_pages (organization_id, surface, title, position, rotation_seconds)
  VALUES (p_org_id, 'tv', 'Time e topo de funil', 1, 20) RETURNING id INTO v_page2;
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, renderer_id, weight, pinned, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page2, 'legacy', 'legacy:thermometer',        'primary', true, 0, 0, 3, 4, 0),
    (p_org_id, v_page2, 'legacy', 'legacy:closer-performance', 'primary', true, 3, 0, 4, 2, 1);
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page2, 'leaf', 'leads_criados',       'total',  'integer', 'primary',   7, 0, 2, 1, 2),
    (p_org_id, v_page2, 'leaf', 'leads_criados',       'origem', 'integer', 'secondary', 7, 2, 3, 2, 3),
    (p_org_id, v_page2, 'leaf', 'reunioes_marcadas',   'total',  'integer', 'primary',   9, 0, 2, 1, 4),
    (p_org_id, v_page2, 'leaf', 'reunioes_realizadas', 'total',  'integer', 'primary',   9, 1, 2, 1, 5),
    (p_org_id, v_page2, 'leaf', 'reunioes_marcadas',   'sdr',    'integer', 'secondary', 3, 2, 3, 2, 6);
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, num_measure_id, den_measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page2, 'ratio', 'reunioes_realizadas', 'reunioes_marcadas', 'total', 'percent_1', 'primary', 7, 1, 2, 1, 7);
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page2, 'leaf', 'leads_na_etapa', 'total', 'integer', 'primary', 11, 0, 1, 1, 8);
  v_created := v_created + 9;

  RETURN jsonb_build_object('seeded', true, 'pages', 2, 'widgets', v_created);
END;
$$;

-- 3. Remove a função de promoção e a tabela de backup (restore já consumido).
DROP FUNCTION IF EXISTS public._fn_reseed_legacy_to_native_unchecked(uuid);
DROP TABLE IF EXISTS public.dashboard_composition_backup;
