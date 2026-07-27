-- 20260727120000_tv_s2_stage_label_scope.sql
--
-- ISSUE #1254 (S2, épico #1194 · ADR-0023) — o MOTOR devolve rótulo humano de
-- etapa + escopo de etapa. DEFEITO visível na TV do CTO. Crivo bloqueante.
--
-- DIAGNÓSTICO (Bancada, prod): `leads_na_etapa · etapa` tem 36 categorias com
-- rótulo = stage-key CRU (`novo`, `p_funil`, `compareceu`). Dois defeitos, ambos
-- do MOTOR (não do renderer — rótulo cru é erro de quem serve o dado, spec §2.4):
--
-- 1. RÓTULO HUMANO. O leaf de etapa devolvia `label = stage_key` (o ramo ELSE do
--    CASE de label). Passa a resolver o NOME de exibição da etapa.
-- 2. ESCOPO. `recorte=etapa` SEM filtro de pipeline soma 36 etapas de FUNIS
--    DIFERENTES — não é um funil, é uma pilha que não se compara. Decisão
--    ratificada (Cais): sem pipeline, DEGRADA para `total` (o número honesto);
--    a galeria passa a exigir pipeline no S4. COM pipeline (um funil só), a série
--    por etapa faz sentido E o stage_key vira nome sem ambiguidade.
--
-- A degradação e a resolução se compõem: a série de etapa só nasce COM
-- pipeline_id no filtro, então o nome é sempre resolvível contra UM pipeline.
--
-- GATE: o motor inteiro já é escopado por composable_metrics_enabled (só orgs com
-- a flag chamam fn_metric_measure). Este defeito-fix herda esse gate — não
-- introduz flag nova (seria flag sobre correção de bug que deixa a parede MAIS
-- honesta). Sinalizado ao Pauta.
--
-- ZERO EXECUTE preservado: label é subquery LIGADA (mesmo padrão de pipeline/
-- closer no motor); degradação é ramo por CASE/IF sobre o VALOR do parâmetro.
--
-- ROLLBACK pareado: rollback/20260727120000_tv_s2_stage_label_scope.sql.

-- ===========================================================================
-- 1. Helper — resolve (pipeline, stage_key) → nome de exibição da etapa
-- ===========================================================================
-- `leads_na_etapa` lê pipeline_entries, que contém pipelines de SISTEMA E CUSTOM
-- (medido em prod: 22.481 system + 13.916 custom entries abertas). São dois
-- mapeamentos distintos e os DOIS precisam resolver:
--   SISTEMA (pipelines.type='system'): pipeline_stages ligado por
--     `ps.pipeline_type = pipelines.slug` (chave canônica do baseline, NÃO
--     pipelines.type que é system|custom), org-scoped.
--   CUSTOM  (pipelines.type='custom'): custom_pipeline_stages por
--     `pipeline_id = pe.pipeline_id` (para custom, pipelines.id == custom_pipelines.id;
--     provado: 13.916/13.916 resolvem por essa chave), org-scoped.
-- COALESCE separa por construção: custom tem slug fora do enum de pipeline_type,
-- então o ramo sistema não casa; sistema tem slug no enum. Fallback = chave crua.
CREATE OR REPLACE FUNCTION public._stage_key_label(
  p_org_id uuid, p_pipeline_id uuid, p_stage_key text
) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT COALESCE(
    (SELECT ps.name
       FROM public.pipeline_stages ps
       JOIN public.pipelines pl ON pl.id = p_pipeline_id AND pl.organization_id = p_org_id
      WHERE ps.pipeline_type = pl.slug
        AND ps.stage_key = p_stage_key
        AND ps.organization_id = p_org_id
      LIMIT 1),
    (SELECT cps.name
       FROM public.custom_pipeline_stages cps
      WHERE cps.pipeline_id = p_pipeline_id
        AND cps.stage_key = p_stage_key
        AND cps.organization_id = p_org_id
      LIMIT 1),
    p_stage_key
  );
$$;
COMMENT ON FUNCTION public._stage_key_label(uuid, uuid, text) IS
  'Resolve (pipeline, stage_key) → nome humano da etapa (#1254 S2). Sistema via '
  'pipeline_stages (ligado por pipelines.slug) + custom via custom_pipeline_stages '
  '(por pipeline_id, pois pipelines.id==custom_pipelines.id p/ custom). Org-scoped. '
  'Fallback = chave crua. pipeline_entries tem SYSTEM e CUSTOM (medido em prod).';
REVOKE EXECUTE ON FUNCTION public._stage_key_label(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._stage_key_label(uuid, uuid, text) TO service_role;

-- ===========================================================================
-- 2. leads_na_etapa — degrada etapa-sem-escopo → total; rótulo humano com escopo
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf_stage_snapshot(
  p_org_id uuid, p_recorte text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_series jsonb; v_base_count bigint; v_scoped boolean;
BEGIN
  v_scoped := (p_filters->>'pipeline_id') IS NOT NULL;

  SELECT count(*) INTO v_base_count
  FROM public.pipeline_entries pe
  WHERE pe.organization_id = p_org_id
    AND pe.closed_at IS NULL
    AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid);

  -- total, OU etapa sem escopo de pipeline → degrada para o número honesto.
  -- SINALIZA a degradação: effective_recorte='total'. Quem degrada CONTA que
  -- degradou — o front usa isso pro rótulo/tipo, não a intenção do widget (senão
  -- a tela mostra "por Etapa / 2151" onde 2151 é o total de N funis = mentira).
  IF p_recorte = 'total' OR (p_recorte = 'etapa' AND NOT v_scoped) THEN
    RETURN jsonb_build_object('value', v_base_count, 'series', NULL,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END,
      'effective_recorte', 'total');
  END IF;

  -- pipeline | etapa(escopado) — série com rótulo humano.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', g.bucket_key,
           'label', COALESCE(
             CASE p_recorte
               WHEN 'pipeline' THEN (SELECT p.name FROM public.pipelines p WHERE p.id = g.bucket_key::uuid)
               WHEN 'etapa'    THEN public._stage_key_label(p_org_id, (p_filters->>'pipeline_id')::uuid, g.bucket_key)
               ELSE g.bucket_key
             END, 'Sem valor'),
           'value', g.val
         ) ORDER BY g.val DESC), '[]'::jsonb)
  INTO v_series
  FROM (
    SELECT
      CASE p_recorte
        WHEN 'pipeline' THEN pe.pipeline_id::text
        WHEN 'etapa'    THEN pe.stage_key
      END AS bucket_key,
      COUNT(*) AS val
    FROM public.pipeline_entries pe
    WHERE pe.organization_id = p_org_id
      AND pe.closed_at IS NULL
      AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid)
    GROUP BY 1
  ) g;

  RETURN jsonb_build_object('value', NULL, 'series', v_series,
    'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
END;
$$;

-- ===========================================================================
-- 3. tempo_medio_etapa — mesma degradação + rótulo humano (consistência)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf_stage_duration(
  p_org_id uuid, p_recorte text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_series jsonb; v_base_count bigint; v_scoped boolean; v_val numeric;
BEGIN
  v_scoped := (p_filters->>'pipeline_id') IS NOT NULL;

  -- Última transição por (lead, pipeline) = etapa atual + instante de entrada.
  SELECT count(*) INTO v_base_count
  FROM (
    SELECT DISTINCT ON (pse.lead_id, pse.pipeline_id) pse.id
    FROM public.pipeline_stage_events pse
    WHERE pse.organization_id = p_org_id
      AND ((p_filters->>'pipeline_id') IS NULL OR pse.pipeline_id = (p_filters->>'pipeline_id')::uuid)
    ORDER BY pse.lead_id, pse.pipeline_id, pse.occurred_at DESC
  ) x;

  -- etapa sem escopo → dwell médio GERAL (um valor), não por etapa de funis distintos.
  IF p_recorte = 'etapa' AND NOT v_scoped THEN
    SELECT round(avg(extract(epoch FROM (now() - latest.occurred_at))))
    INTO v_val
    FROM (
      SELECT DISTINCT ON (pse.lead_id, pse.pipeline_id) pse.occurred_at
      FROM public.pipeline_stage_events pse
      WHERE pse.organization_id = p_org_id
      ORDER BY pse.lead_id, pse.pipeline_id, pse.occurred_at DESC
    ) latest;
    RETURN jsonb_build_object('value', v_val, 'series', NULL,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END,
      'effective_recorte', 'total');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', g.bucket_key,
           'label', COALESCE(
             CASE p_recorte
               WHEN 'pipeline' THEN (SELECT p.name FROM public.pipelines p WHERE p.id = g.bucket_key::uuid)
               WHEN 'etapa'    THEN public._stage_key_label(p_org_id, (p_filters->>'pipeline_id')::uuid, g.bucket_key)
               ELSE g.bucket_key
             END, 'Sem valor'),
           'value', round(g.avg_secs)
         ) ORDER BY g.avg_secs DESC), '[]'::jsonb)
  INTO v_series
  FROM (
    SELECT
      CASE p_recorte
        WHEN 'pipeline' THEN latest.pipeline_id::text
        WHEN 'etapa'    THEN latest.to_stage_key
      END AS bucket_key,
      avg(extract(epoch FROM (now() - latest.occurred_at))) AS avg_secs
    FROM (
      SELECT DISTINCT ON (pse.lead_id, pse.pipeline_id)
        pse.pipeline_id, pse.to_stage_key, pse.occurred_at
      FROM public.pipeline_stage_events pse
      WHERE pse.organization_id = p_org_id
        AND ((p_filters->>'pipeline_id') IS NULL OR pse.pipeline_id = (p_filters->>'pipeline_id')::uuid)
      ORDER BY pse.lead_id, pse.pipeline_id, pse.occurred_at DESC
    ) latest
    GROUP BY 1
  ) g;

  RETURN jsonb_build_object('value', NULL, 'series', v_series,
    'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
END;
$$;

-- ===========================================================================
-- 4. _metric_leaf — estampa o recorte EFETIVO (o leaf pode degradar)
-- ===========================================================================
-- Única mudança vs o corpo de 20260723100100: o 'recorte' devolvido passa a ser
-- COALESCE(effective_recorte do leaf, p_recorte). Assim, quando o leaf degrada
-- (etapa-sem-pipeline → total), o motor CONTA a degradação no próprio retorno, e
-- o front lê measure.recorte='total' → rótulo sem "por Etapa" + tipo número.
-- Verdade onde a decisão foi tomada; o front só reporta.
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
    WHEN 'receita'             THEN public._metric_leaf_sales(p_org_id, 'revenue', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'num_vendas'          THEN public._metric_leaf_sales(p_org_id, 'count',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_criados'       THEN public._metric_leaf_leads_criados(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_marcadas'   THEN public._metric_leaf_meetings(p_org_id, 'meeting_booked', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_realizadas' THEN public._metric_leaf_meetings(p_org_id, 'meeting_held',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_na_etapa'      THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters)
    WHEN 'tempo_medio_etapa'   THEN public._metric_leaf_stage_duration(p_org_id, p_recorte, p_filters)
  END;

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
