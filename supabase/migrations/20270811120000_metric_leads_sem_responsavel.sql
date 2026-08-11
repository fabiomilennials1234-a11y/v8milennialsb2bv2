-- 20270811120000_metric_leads_sem_responsavel.sql
--
-- SCRUM-311, primeira fatia: porta "Leads sem responsável" para o catálogo
-- fechado do motor (ADR-0023). Serve de MOLDE para as demais 18 — uma medida
-- por migration, nunca em lote.
--
-- POR QUE ESTA PRIMEIRO
--
-- É a única do inventário que aparece em DUAS superfícies: vira métrica do
-- Estúdio e alimenta a faixa "Sem responsável" do Comando (SCRUM-302). Hoje o
-- produto só expõe o COMPLEMENTO — useLeadsStats conta quem TEM dono, e mora
-- no módulo leads, não em analytics.
--
-- Medido em prod (2026-08-11): 25.114 leads ativos sem nenhum responsável, em
-- 68 organizações.
--
-- DEFINIÇÃO
--
-- Lead ativo (não apagado, não sombra) sem NENHUM dos três donos canônicos.
-- Os três são espelhados por trigger (20261125000003), então checar os três é
-- redundante hoje — e proposital: se o espelho quebrar, a medida não passa a
-- contar lead com dono como órfão.
--
-- ÂNCORA 'hoje', como leads_na_etapa: é ESTADO ATUAL, não contagem de período.
-- "Quantos estão sem dono agora" é a pergunta; "quantos ficaram sem dono em
-- julho" é outra medida, e não é esta.
--
-- INVARIANTES DO MOTOR MANTIDAS
--   • zero EXECUTE — SQL estático, filtro por parâmetro ligado
--   • SECURITY DEFINER + STABLE + SET search_path = 'public'
--   • filtro por organization_id em toda consulta
--   • REVOKE dos TRÊS (PUBLIC, anon, authenticated) + bloco DO que ABORTA
--
-- CORREÇÃO DE ROBUSTEZ, de brinde: o CASE de _metric_leaf não tinha ELSE.
-- Medida catalogada sem ramo no motor devolvia NULL silencioso — número em
-- branco na tela, sem erro em lugar nenhum. Agora levanta exceção.
--
-- ROLLBACK pareado: rollback/20270811120000_metric_leads_sem_responsavel.sql

-- ===========================================================================
-- 1 — CATÁLOGO
-- ===========================================================================
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort) VALUES
  ('leads_sem_responsavel', 'Leads sem responsável', 'count', 'hoje',
   'Leads ativos sem nenhum responsável atribuído. Estado atual, não contagem do período.', 65)
ON CONFLICT (id) DO NOTHING;

-- Sem 'tempo': medida de estado não tem série temporal. Sem 'produto' e sem
-- os cortes por pessoa — perguntar "leads sem dono por vendedor" é contradição.
INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id) VALUES
  ('leads_sem_responsavel', 'total'),
  ('leads_sem_responsavel', 'origem'),
  ('leads_sem_responsavel', 'tag')
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_measure_formats (measure_id, format_id) VALUES
  ('leads_sem_responsavel', 'integer')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 2 — LEAF
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf_leads_sem_dono(
  p_org_id uuid, p_recorte text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val numeric; v_series jsonb; v_base_count bigint;
BEGIN
  SELECT count(*) INTO v_base_count
  FROM public.leads l
  WHERE l.organization_id = p_org_id
    AND l.deleted_at IS NULL
    AND COALESCE(l.is_shadow, false) = false
    AND l.responsible_id IS NULL
    AND l.sale_responsible_id IS NULL
    AND l.pre_sale_responsible_id IS NULL
    AND ((p_filters->>'origin') IS NULL OR l.origin = (p_filters->>'origin'))
    AND ((p_filters->>'tag_id') IS NULL OR EXISTS (
          SELECT 1 FROM public.lead_tags lt
          WHERE lt.lead_id = l.id AND lt.tag_id = (p_filters->>'tag_id')::uuid));

  IF p_recorte = 'total' THEN
    v_val := v_base_count;
    RETURN jsonb_build_object('value', v_val, 'series', NULL,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);

  ELSIF p_recorte = 'tag' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', g.tag_id, 'label', COALESCE(g.tag_name, 'Sem tag'), 'value', g.val
           ) ORDER BY g.val DESC), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT t.id AS tag_id, t.name AS tag_name, COUNT(*) AS val
      FROM public.leads l
      JOIN public.lead_tags lt ON lt.lead_id = l.id
      JOIN public.tags t ON t.id = lt.tag_id
      WHERE l.organization_id = p_org_id
        AND l.deleted_at IS NULL
        AND COALESCE(l.is_shadow, false) = false
        AND l.responsible_id IS NULL
        AND l.sale_responsible_id IS NULL
        AND l.pre_sale_responsible_id IS NULL
        AND ((p_filters->>'origin') IS NULL OR l.origin = (p_filters->>'origin'))
      GROUP BY t.id, t.name
    ) g;
    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);

  ELSE
    -- origem
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', g.bucket_key,
             'label', COALESCE(g.bucket_key, 'Sem origem'),
             'value', g.val
           ) ORDER BY g.val DESC), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT l.origin AS bucket_key, COUNT(*) AS val
      FROM public.leads l
      WHERE l.organization_id = p_org_id
        AND l.deleted_at IS NULL
        AND COALESCE(l.is_shadow, false) = false
        AND l.responsible_id IS NULL
        AND l.sale_responsible_id IS NULL
        AND l.pre_sale_responsible_id IS NULL
        AND ((p_filters->>'tag_id') IS NULL OR EXISTS (
              SELECT 1 FROM public.lead_tags lt
              WHERE lt.lead_id = l.id AND lt.tag_id = (p_filters->>'tag_id')::uuid))
      GROUP BY l.origin
    ) g;
    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
  END IF;
END;
$$;

-- Interna: service_role apenas, como as outras seis do motor.
REVOKE EXECUTE ON FUNCTION public._metric_leaf_leads_sem_dono(uuid, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_leads_sem_dono(uuid, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_leads_sem_dono(uuid, text, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_leads_sem_dono(uuid, text, jsonb) TO service_role;

-- ===========================================================================
-- 3 — DESPACHANTE (+ guarda contra medida sem ramo)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf(
  p_org_id uuid, p_measure_id text, p_recorte text,
  p_period text, p_ref date, p_start date, p_end date, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_unit text; v_anchor text; v_tz text; v_bounds tstzrange; v_leaf jsonb;
BEGIN
  SELECT m.unit, m.anchor INTO v_unit, v_anchor
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
    WHEN 'receita'               THEN public._metric_leaf_sales(p_org_id, 'revenue', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'num_vendas'            THEN public._metric_leaf_sales(p_org_id, 'count',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_criados'         THEN public._metric_leaf_leads_criados(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_marcadas'     THEN public._metric_leaf_meetings(p_org_id, 'meeting_booked', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_realizadas'   THEN public._metric_leaf_meetings(p_org_id, 'meeting_held',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_na_etapa'        THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters)
    WHEN 'tempo_medio_etapa'     THEN public._metric_leaf_stage_duration(p_org_id, p_recorte, p_filters)
    WHEN 'leads_sem_responsavel' THEN public._metric_leaf_leads_sem_dono(p_org_id, p_recorte, p_filters)
  END;

  -- Guarda nova. Antes, medida catalogada sem ramo aqui caía no NULL implícito
  -- do CASE e o motor devolvia value e series nulos SEM erro — número em
  -- branco na tela e nada nos logs. Falhar alto é melhor que mentir baixo.
  IF v_leaf IS NULL THEN
    RAISE EXCEPTION 'measure % has no leaf implementation', p_measure_id
      USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'measure_id', p_measure_id,
    'unit', v_unit,
    'currency', CASE WHEN v_unit = 'currency' THEN 'BRL' ELSE NULL END,
    'anchor', v_anchor,
    -- recorte EFETIVO: o leaf pode ter degradado (etapa→total). O motor conta.
    'recorte', COALESCE(v_leaf->>'effective_recorte', p_recorte),
    'value',   v_leaf->'value',
    'series',  v_leaf->'series',
    'empty_reason', v_leaf->>'empty_reason'
  );
END;
$$;

-- CREATE OR REPLACE PRESERVA o proacl existente — reescrever os REVOKEs é o que
-- garante o estado correto num ambiente novo, onde a função nasce do zero e
-- herda o grant nominal do ALTER DEFAULT PRIVILEGES.
REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, jsonb) TO service_role;

-- ===========================================================================
-- 4 — GUARDA QUE ABORTA
-- ===========================================================================
-- Migration verde não prova nada: o grant é concedido pelo banco no CREATE,
-- não pelo SQL acima. E a armadilha tem duas metades independentes — grant
-- herdado de PUBLIC e grant nominal via ALTER DEFAULT PRIVILEGES —, uma
-- escondendo a outra. Só has_function_privilege fecha o item.
DO $guard$
DECLARE
  v_fn regprocedure := 'public._metric_leaf_leads_sem_dono(uuid, text, jsonb)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: anon executa % — REVOKE não pegou', v_fn;
  END IF;
  IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: authenticated executa % — leaf interno não pode', v_fn;
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: service_role NÃO executa % — o motor não roda', v_fn;
  END IF;

  -- O wrapper público continua acessível: se este REVOKE vazar para ele, o
  -- Estúdio inteiro para.
  IF NOT has_function_privilege(
       'authenticated',
       'public.fn_metric_measure(uuid, jsonb, text, text, date, date, date, jsonb)'::regprocedure,
       'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: authenticated perdeu fn_metric_measure';
  END IF;
END
$guard$;
