-- 20260723100300_fn_dashboard_snapshot.sql
--
-- ISSUE #1194 (PRD #986 · ADR-0023) — Métricas Montáveis, Camada 2, fatia 4/5.
-- Caminho de leitura em lote: uma página inteira num round-trip.
--
-- fn_dashboard_snapshot(org, page, period, ref, start, end) → jsonb
--   { "disabled": bool, "page_id": uuid, "widgets": [ {widget..} | {error} ] }
--
-- DISCIPLINA (ADR-0023 / design §5.3, §6.1):
--   - assert_org_access 1ª instrução (padrão canônico).
--   - Gate pela flag de rollout: flag OFF → devolve {disabled:true, widgets:[]}.
--   - A TV liga o dia todo e faz poll a cada 30s: UM fetch por página, os
--     widgets trocam em memória. Teto de 12 widgets/página (orçamento #1208).
--   - ERRO ISOLADO POR WIDGET: um widget que estoura NÃO derruba a página —
--     vira {widget_id, error:'unavailable'} e a parede continua. BEGIN/EXCEPTION
--     por widget dentro do loop.
--
-- ROLLBACK pareado: rollback/20260723100300_fn_dashboard_snapshot.sql (DROP).

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
  -- 1ª INSTRUÇÃO.
  PERFORM public.assert_org_access(p_org_id);

  -- Gate de rollout — nada é visível até a flag ligar por org.
  IF NOT public.fn_composable_metrics_enabled(p_org_id) THEN
    RETURN jsonb_build_object('disabled', true, 'page_id', p_page_id, 'widgets', '[]'::jsonb);
  END IF;

  -- Página tem que ser da org (defesa além da RLS, já que esta fn é DEFINER).
  IF NOT EXISTS (SELECT 1 FROM public.dashboard_pages dp
                 WHERE dp.id = p_page_id AND dp.organization_id = p_org_id) THEN
    RAISE EXCEPTION 'page % not found for org %', p_page_id, p_org_id USING ERRCODE = 'P0002';
  END IF;

  -- Widgets publicados da página, teto 12. Ordem estável (position, id).
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
      -- Widget quebrado isolado: não derruba a página.
      v_widgets := v_widgets || jsonb_build_object('widget_id', r.id, 'error', 'unavailable');
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'disabled', false,
    'page_id', p_page_id,
    'widgets', v_widgets
  );
END;
$$;

COMMENT ON FUNCTION public.fn_dashboard_snapshot(uuid, uuid, text, date, date, date) IS
  'Snapshot de página inteira das Métricas Montáveis (#1194 / ADR-0023) num '
  'round-trip. assert_org_access 1º, gate pela flag, teto 12 widgets, erro '
  'isolado por widget (não derruba a página). Consumido pela TV (poll 30s).';

REVOKE EXECUTE ON FUNCTION public.fn_dashboard_snapshot(uuid, uuid, text, date, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_dashboard_snapshot(uuid, uuid, text, date, date, date) TO authenticated, service_role;
