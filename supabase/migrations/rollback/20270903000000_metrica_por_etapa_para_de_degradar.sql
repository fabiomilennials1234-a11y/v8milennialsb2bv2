-- rollback/20270903000000_metrica_por_etapa_para_de_degradar.sql
--
-- Devolve os dois leaves ao corpo vigente ANTES de 20270903000000, com o ramo
-- de degradação de volta: recorte `etapa` sem funil escolhido volta a devolver
-- escalar rotulado `total`.
--
-- Só rode isto se a quebra por (funil, etapa) provar estar errada. O estado
-- para o qual este arquivo volta é o que faz a janela "Tempo médio na etapa"
-- mostrar um número só.
--
-- `_stage_bucket_label` é DROPADA por último — os dois leaves precisam parar de
-- referenciá-la antes.

CREATE OR REPLACE FUNCTION public._metric_leaf_stage_duration(
  p_org_id uuid, p_recorte text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_series jsonb; v_base_count bigint; v_scoped boolean; v_val numeric;
BEGIN
  v_scoped := (p_filters->>'pipeline_id') IS NOT NULL;

  SELECT count(*) INTO v_base_count
  FROM (
    SELECT DISTINCT ON (pse.lead_id, pse.pipeline_id) pse.id
    FROM public.pipeline_stage_events pse
    WHERE pse.organization_id = p_org_id
      AND ((p_filters->>'pipeline_id') IS NULL OR pse.pipeline_id = (p_filters->>'pipeline_id')::uuid)
    ORDER BY pse.lead_id, pse.pipeline_id, pse.occurred_at DESC
  ) x;

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

CREATE OR REPLACE FUNCTION public._metric_leaf_stage_snapshot(
  p_org_id uuid, p_recorte text, p_filters jsonb, p_unidade text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val numeric; v_series jsonb; v_base_count bigint; v_scoped boolean;
BEGIN
  IF p_unidade NOT IN ('negocio', 'lead') THEN
    RAISE EXCEPTION 'unidade % desconhecida no snapshot de etapa', p_unidade
      USING ERRCODE = '22023';
  END IF;

  v_scoped := (p_filters->>'pipeline_id') IS NOT NULL;

  SELECT count(*) INTO v_base_count
  FROM public.pipeline_entries pe
  WHERE pe.organization_id = p_org_id
    AND pe.closed_at IS NULL
    AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid);

  IF p_recorte = 'total' OR (p_recorte = 'etapa' AND NOT v_scoped) THEN
    SELECT CASE p_unidade
             WHEN 'negocio' THEN count(*)
             ELSE                count(DISTINCT pe.lead_id)
           END
    INTO v_val
    FROM public.pipeline_entries pe
    WHERE pe.organization_id = p_org_id
      AND pe.closed_at IS NULL
      AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid);

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
           'value', g.val
         ) ORDER BY g.val DESC), '[]'::jsonb)
  INTO v_series
  FROM (
    SELECT
      CASE p_recorte
        WHEN 'pipeline' THEN pe.pipeline_id::text
        WHEN 'etapa'    THEN pe.stage_key
      END AS bucket_key,
      CASE p_unidade
        WHEN 'negocio' THEN count(*)
        ELSE                count(DISTINCT pe.lead_id)
      END AS val
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

-- Volta a agrupar por `stage_key` cru: etapas homônimas de funis diferentes
-- somam num balde só, rotulado com o slug.
CREATE OR REPLACE FUNCTION public._metric_leaf_negocios_abertos(
  p_org_id uuid, p_recorte text, p_bounds tstzrange, p_tz text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val numeric; v_series jsonb; v_base_count bigint;
BEGIN
  SELECT count(*) INTO v_base_count
  FROM public.pipeline_entries pe
  LEFT JOIN public.leads l ON l.id = pe.lead_id
  WHERE pe.organization_id = p_org_id
    AND pe.entered_at <@ p_bounds
    AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid)
    AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'));

  IF p_recorte = 'total' THEN
    RETURN jsonb_build_object('value', v_base_count, 'series', NULL,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', g.bucket_key,
             'label', COALESCE(
               CASE p_recorte
                 WHEN 'pipeline' THEN (SELECT p.name FROM public.pipelines p WHERE p.id = g.bucket_key::uuid)
                 WHEN 'tempo'    THEN to_char(g.bucket_key::date, 'DD/MM')
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
          WHEN 'origem'   THEN l.origin
          WHEN 'tempo'    THEN to_char(pe.entered_at AT TIME ZONE p_tz, 'YYYY-MM-DD')
        END AS bucket_key,
        count(*) AS val
      FROM public.pipeline_entries pe
      LEFT JOIN public.leads l ON l.id = pe.lead_id
      WHERE pe.organization_id = p_org_id
        AND pe.entered_at <@ p_bounds
        AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid)
        AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'))
      GROUP BY 1
    ) g;

    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public._stage_bucket_label(uuid, uuid, text, boolean);
