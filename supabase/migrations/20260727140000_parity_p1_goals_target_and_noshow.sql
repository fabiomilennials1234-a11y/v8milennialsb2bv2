-- 20260727140000_parity_p1_goals_target_and_noshow.sql
--
-- ISSUE #1292 (P1 da PARIDADE, épico #1194 · ADR-0023) — as 2 MEDIDAS que faltam.
-- Área frágil: MOTOR + meta. Crivo BLOQUEANTE. ZERO EXECUTE intacto.
--
-- DDL PURA: sem DO block, sem escrita de dado de CLIENTE (guarda F4). Só cataloga
-- (metric_catalog_* = dado de SISTEMA) e substitui funções do motor.
--
-- D1 — motor SERVE ALVO (liga `goals`, #1268). O termômetro degradava a Número por
--   falta de alvo; agora o motor LÊ `goals.target_value` da org+mês corrente e
--   devolve `target` no payload da medida. NÃO inventa medida. Mapa measure→goal
--   type numa coluna do catálogo (`metric_catalog_measures.goal_type`), data-driven.
--   MEDIDO em prod (Milennials): goals.type ∈ {faturamento(org-level, R$60-260k),
--   vendas(por-membro, money), reunioes, reunioes_realizadas, reunioes_marcadas}.
--   Mapeio o CLARO (receita→'faturamento' org-level = o termômetro #1) + os de nome
--   exato; os AMBÍGUOS ficam null e sinalizados a Cais (ver nota abaixo).
--
-- D2 — nova medida-LEAF `reunioes_no_show` = count(booked) − count(held) na janela,
--   clamp ≥ 0. É um count-leaf ESTÁTICO no _metric_leaf (não `a−b` no nó de razão —
--   isso furaria o ZERO EXECUTE, e a razão prof-1/2-filhos não faz a−b). no-show%
--   depois vira razão `reunioes_no_show / reunioes_marcadas`, que o motor já sabe.
--
-- ⚠ NOTA A CAIS (mapa goal_type ambíguo, decido default + sinalizo):
--   • receita → 'faturamento' (5 linhas, TODAS org-level, money) — claro, é o alvo do termômetro.
--   • reunioes_realizadas → 'reunioes_realizadas' (nome exato) — claro.
--   • reunioes_marcadas → 'reunioes' (7) OU 'reunioes_marcadas' (1)? Escolhi 'reunioes' (dominante). Ambíguo.
--   • num_vendas → SEM goal de contagem ('vendas' é money/receita por-membro, não count) → null.
--   Se o mapa certo divergir, é UPDATE de 1 coluna do catálogo — sem tocar o motor.
--
-- ROLLBACK pareado: rollback/20260727140000_parity_p1_goals_target_and_noshow.sql

-- ===========================================================================
-- D2.1 — catálogo: nova medida reunioes_no_show + compat
-- ===========================================================================
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort) VALUES
  ('reunioes_no_show', 'Reuniões no-show', 'count', 'fechamentos',
   'Reuniões marcadas que não compareceram: booked − held na janela (clamp ≥ 0).', 55)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id) VALUES
  ('reunioes_no_show','total'),('reunioes_no_show','sdr'),
  ('reunioes_no_show','origem'),('reunioes_no_show','tempo')
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_measure_formats (measure_id, format_id) VALUES
  ('reunioes_no_show','integer')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- D2.2 — leaf de NO-SHOW (booked − held por janela, ZERO EXECUTE)
-- ===========================================================================
-- booked ancora em occurred_at; held em COALESCE(meeting_date, occurred_at) — as
-- duas âncoras na MESMA cláusula por OR sobre o event_type (valor, não identificador).
-- no-show = count(booked) − count(held), clamp ≥ 0 (held sem booked é ruído de dado,
-- nunca no-show negativo). Recorte série: booked−held POR bucket.
CREATE OR REPLACE FUNCTION public._metric_leaf_no_show(
  p_org_id uuid, p_recorte text, p_bounds tstzrange, p_tz text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val numeric; v_series jsonb; v_base_count bigint;
BEGIN
  SELECT count(*) INTO v_base_count
  FROM public.meeting_events me
  LEFT JOIN public.leads l ON l.id = me.lead_id
  WHERE me.organization_id = p_org_id
    AND me.event_type IN ('meeting_booked','meeting_held')
    AND ((me.event_type = 'meeting_booked' AND me.occurred_at <@ p_bounds)
         OR (me.event_type = 'meeting_held'   AND COALESCE(me.meeting_date, me.occurred_at) <@ p_bounds))
    AND ((p_filters->>'member_id') IS NULL OR me.pre_sale_responsible_id = (p_filters->>'member_id')::uuid)
    AND ((p_filters->>'origin')    IS NULL OR l.origin = (p_filters->>'origin'));

  IF p_recorte = 'total' THEN
    SELECT GREATEST(
             count(*) FILTER (WHERE me.event_type = 'meeting_booked') -
             count(*) FILTER (WHERE me.event_type = 'meeting_held'), 0)
    INTO v_val
    FROM public.meeting_events me
    LEFT JOIN public.leads l ON l.id = me.lead_id
    WHERE me.organization_id = p_org_id
      AND me.event_type IN ('meeting_booked','meeting_held')
      AND ((me.event_type = 'meeting_booked' AND me.occurred_at <@ p_bounds)
           OR (me.event_type = 'meeting_held'   AND COALESCE(me.meeting_date, me.occurred_at) <@ p_bounds))
      AND ((p_filters->>'member_id') IS NULL OR me.pre_sale_responsible_id = (p_filters->>'member_id')::uuid)
      AND ((p_filters->>'origin')    IS NULL OR l.origin = (p_filters->>'origin'));

    RETURN jsonb_build_object('value', v_val, 'series', NULL,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
  ELSE
    -- sdr | origem | tempo
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', g.bucket_key,
             'label', COALESCE(
               CASE p_recorte
                 WHEN 'sdr'   THEN (SELECT tm.name FROM public.team_members tm WHERE tm.id = g.bucket_key::uuid)
                 WHEN 'tempo' THEN to_char(g.bucket_key::date, 'DD/MM')
                 ELSE g.bucket_key
               END,
               CASE p_recorte WHEN 'sdr' THEN 'Sem atribuição' ELSE 'Sem valor' END),
             'value', g.val
           ) ORDER BY g.val DESC), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT
        CASE p_recorte
          WHEN 'sdr'    THEN me.pre_sale_responsible_id::text
          WHEN 'origem' THEN l.origin
          WHEN 'tempo'  THEN to_char(
            (CASE WHEN me.event_type = 'meeting_held'
                  THEN COALESCE(me.meeting_date, me.occurred_at) ELSE me.occurred_at END) AT TIME ZONE p_tz, 'YYYY-MM-DD')
        END AS bucket_key,
        GREATEST(
          count(*) FILTER (WHERE me.event_type = 'meeting_booked') -
          count(*) FILTER (WHERE me.event_type = 'meeting_held'), 0) AS val
      FROM public.meeting_events me
      LEFT JOIN public.leads l ON l.id = me.lead_id
      WHERE me.organization_id = p_org_id
        AND me.event_type IN ('meeting_booked','meeting_held')
        AND ((me.event_type = 'meeting_booked' AND me.occurred_at <@ p_bounds)
             OR (me.event_type = 'meeting_held'   AND COALESCE(me.meeting_date, me.occurred_at) <@ p_bounds))
        AND ((p_filters->>'member_id') IS NULL OR me.pre_sale_responsible_id = (p_filters->>'member_id')::uuid)
        AND ((p_filters->>'origin')    IS NULL OR l.origin = (p_filters->>'origin'))
      GROUP BY 1
    ) g;

    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._metric_leaf_no_show(uuid, text, tstzrange, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_no_show(uuid, text, tstzrange, text, jsonb) TO service_role;

-- ===========================================================================
-- D1.1 — catálogo: goal_type (measure → type de goals). null = sem alvo.
-- ===========================================================================
ALTER TABLE public.metric_catalog_measures ADD COLUMN IF NOT EXISTS goal_type text;
COMMENT ON COLUMN public.metric_catalog_measures.goal_type IS
  'type de public.goals que serve o ALVO desta medida (#1292 D1). null = medida '
  'sem alvo. O motor lê goals.target_value da org+mês corrente por este type.';

-- Mapa DECIDIDO por Cais (medido em prod, semântica vence volume):
--   receita → 'faturamento' (5 org-level, tem 7/2026 ~260k = o termômetro do mockup).
--   reunioes_marcadas → 'reunioes_marcadas' (1 linha org-level jun/2026 = convenção
--     ATUAL; 'reunioes'(7) é cadastro LEGADO abandonado Feb-May → não usar).
--   reunioes_realizadas → 'reunioes_realizadas' (nome exato).
--   num_vendas → NULL: 'vendas'(14) é meta de DINHEIRO por-membro, não contagem —
--     não inventa termômetro de count (o mockup não pede). ('vendas' pode alimentar
--     goal por-closer numa fatia futura.)
UPDATE public.metric_catalog_measures SET goal_type = 'faturamento'         WHERE id = 'receita';
UPDATE public.metric_catalog_measures SET goal_type = 'reunioes_marcadas'   WHERE id = 'reunioes_marcadas';
UPDATE public.metric_catalog_measures SET goal_type = 'reunioes_realizadas' WHERE id = 'reunioes_realizadas';

-- ===========================================================================
-- D1.2 + D2.3 — _metric_leaf: rota do no_show + estampa `target` de goals
-- ===========================================================================
-- OR REPLACE sobre a versão S2 (mantém effective_recorte). Adiciona: (a) rota
-- reunioes_no_show → _metric_leaf_no_show; (b) leitura de goal_type; (c) target de
-- goals (org+mês corrente do bounds; org-level salvo filtro de membro). Bind puro.
CREATE OR REPLACE FUNCTION public._metric_leaf(
  p_org_id uuid, p_measure_id text, p_recorte text,
  p_period text, p_ref date, p_start date, p_end date, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_unit text; v_anchor text; v_goal_type text; v_tz text;
  v_bounds tstzrange; v_leaf jsonb; v_target numeric;
BEGIN
  SELECT m.unit, m.anchor, m.goal_type INTO v_unit, v_anchor, v_goal_type
  FROM public.metric_catalog_measures m WHERE m.id = p_measure_id;
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'unknown measure %', p_measure_id USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.metric_catalog_measure_recortes mr
    WHERE mr.measure_id = p_measure_id AND mr.recorte_id = p_recorte
  ) THEN
    RAISE EXCEPTION 'recorte % incompatible with measure %', p_recorte, p_measure_id
      USING ERRCODE = '22023';
  END IF;

  IF v_anchor <> 'hoje' THEN
    SELECT o.timezone INTO v_tz FROM public.organizations o WHERE o.id = p_org_id;
    v_bounds := public.metric_period_bounds(p_org_id, p_period, p_ref, p_start, p_end);
  END IF;

  v_leaf := CASE p_measure_id
    WHEN 'receita'             THEN public._metric_leaf_sales(p_org_id, 'revenue', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'num_vendas'          THEN public._metric_leaf_sales(p_org_id, 'count',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_criados'       THEN public._metric_leaf_leads_criados(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_marcadas'   THEN public._metric_leaf_meetings(p_org_id, 'meeting_booked', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_realizadas' THEN public._metric_leaf_meetings(p_org_id, 'meeting_held',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_no_show'    THEN public._metric_leaf_no_show(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_na_etapa'      THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters)
    WHEN 'tempo_medio_etapa'   THEN public._metric_leaf_stage_duration(p_org_id, p_recorte, p_filters)
  END;

  -- ALVO (#1292 D1): motor LÊ goals — org + mês corrente (do bounds). Org-level
  -- salvo filtro de membro. Sem goal_type ou sem bounds (snapshot) → sem alvo.
  IF v_goal_type IS NOT NULL AND v_bounds IS NOT NULL THEN
    SELECT sum(g.target_value) INTO v_target
    FROM public.goals g
    WHERE g.organization_id = p_org_id
      AND g.type = v_goal_type
      AND g.month = extract(month FROM (lower(v_bounds) AT TIME ZONE v_tz))::int
      AND g.year  = extract(year  FROM (lower(v_bounds) AT TIME ZONE v_tz))::int
      AND (
        ((p_filters->>'member_id') IS NULL AND g.team_member_id IS NULL)
        OR g.team_member_id = (p_filters->>'member_id')::uuid
      );
  END IF;

  RETURN jsonb_build_object(
    'measure_id', p_measure_id,
    'unit', v_unit,
    'currency', CASE WHEN v_unit = 'currency' THEN 'BRL' ELSE NULL END,
    'anchor', v_anchor,
    'recorte', COALESCE(v_leaf->>'effective_recorte', p_recorte),
    'value',   v_leaf->'value',
    'series',  v_leaf->'series',
    'target',  v_target,
    'empty_reason', v_leaf->>'empty_reason'
  );
END;
$$;
